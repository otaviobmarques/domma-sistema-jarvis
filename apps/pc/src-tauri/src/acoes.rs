//! As "mãos" do Jarvis no PC. Cada ação recebe parâmetros JSON do cérebro e
//! devolve texto (e, no print, uma imagem).
use crate::api::{Acao, Imagem, Resultado};
use base64::Engine;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// Botão de pânico local: interrompe teclado/mouse imediatamente.
pub static PARAR: AtomicBool = AtomicBool::new(false);

/// Geometria do último print, para converter coordenadas do print → tela real.
#[derive(Clone, Copy)]
struct Geo {
    x: i32,
    y: i32,
    escala: f64,
}
static ULTIMO_PRINT: Mutex<Option<Geo>> = Mutex::new(None);

const LARGURA_MAX_PRINT: u32 = 1366;

fn s(p: &Value, k: &str) -> String {
    p.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
fn i(p: &Value, k: &str) -> Option<i64> {
    p.get(k).and_then(|v| v.as_i64())
}

/// Expande ~, ~/Desktop, ~/Documents, ~/Downloads (respeitando pastas redirecionadas, ex.: OneDrive).
pub fn expandir(caminho: &str) -> PathBuf {
    let c = caminho.trim().replace('\\', "/");
    let mapear = |prefixo: &str, dir: Option<PathBuf>| -> Option<PathBuf> {
        let resto = c.strip_prefix(prefixo)?;
        let base = dir?;
        Some(if resto.is_empty() { base } else { base.join(resto.trim_start_matches('/')) })
    };
    mapear("~/Desktop", dirs::desktop_dir())
        .or_else(|| mapear("~/Área de Trabalho", dirs::desktop_dir()))
        .or_else(|| mapear("~/Documents", dirs::document_dir()))
        .or_else(|| mapear("~/Documentos", dirs::document_dir()))
        .or_else(|| mapear("~/Downloads", dirs::download_dir()))
        .or_else(|| mapear("~", dirs::home_dir()))
        .unwrap_or_else(|| PathBuf::from(caminho.trim()))
}

pub async fn executar(a: &Acao) -> Resultado {
    let p = &a.params;
    let r: Result<(String, Option<Imagem>), String> = match a.acao.as_str() {
        "abrir" => abrir(&s(p, "alvo")).map(|t| (t, None)),
        "arquivos" => arquivos(p).map(|t| (t, None)),
        "apagar" => apagar(&s(p, "caminho")).map(|t| (t, None)),
        "comando" => comando(&s(p, "comando")).await.map(|t| (t, None)),
        "janelas" => janelas().await.map(|t| (t, None)),
        "print" => print(i(p, "monitor").unwrap_or(0) as usize).map(|(t, img)| (t, Some(img))),
        "mouse" => mouse(p).map(|t| (t, None)),
        "teclado" => teclado(p).map(|t| (t, None)),
        "parar" => {
            PARAR.store(true, Ordering::SeqCst);
            soltar_teclas();
            Ok(("Parado.".into(), None))
        }
        outra => Err(format!("Ação desconhecida: {outra}. Atualize o app do Jarvis.")),
    };
    match r {
        Ok((texto, imagem)) => Resultado { id: a.id.clone(), ok: true, texto, imagem },
        Err(e) => Resultado { id: a.id.clone(), ok: false, texto: e, imagem: None },
    }
}

// ------------------------------------------------------------------ abrir
fn abrir(alvo: &str) -> Result<String, String> {
    let alvo = alvo.trim();
    if alvo.is_empty() {
        return Err("Diga o que abrir.".into());
    }
    let lower = alvo.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
        opener::open(alvo).map_err(|e| e.to_string())?;
        return Ok(format!("Abri {alvo}."));
    }
    let caminho = expandir(alvo);
    if caminho.exists() {
        opener::open(&caminho).map_err(|e| e.to_string())?;
        return Ok(format!("Abri {}.", caminho.display()));
    }
    // Nomes comuns → executáveis do Windows
    let exe = match lower.as_str() {
        "excel" => "excel",
        "word" => "winword",
        "powerpoint" => "powerpnt",
        "outlook" => "outlook",
        "chrome" | "google chrome" => "chrome",
        "edge" | "navegador" => "msedge",
        "calculadora" | "calc" => "calc",
        "bloco de notas" | "notepad" => "notepad",
        "explorador" | "explorer" | "arquivos" => "explorer",
        "terminal" | "powershell" => "powershell",
        "configurações" | "configuracoes" => "ms-settings:",
        "whatsapp" => "whatsapp:",
        _ => alvo,
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", exe])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        opener::open(exe).map_err(|e| e.to_string())?;
    }
    Ok(format!("Abri {alvo}."))
}

// ------------------------------------------------------------------ arquivos
fn arquivos(p: &Value) -> Result<String, String> {
    let acao = s(p, "acao");
    let caminho = expandir(&s(p, "caminho"));
    match acao.as_str() {
        "listar" => {
            let mut itens: Vec<(bool, String, u64)> = std::fs::read_dir(&caminho)
                .map_err(|e| format!("{}: {e}", caminho.display()))?
                .filter_map(|e| e.ok())
                .map(|e| {
                    let m = e.metadata().ok();
                    (m.as_ref().map(|m| m.is_dir()).unwrap_or(false), e.file_name().to_string_lossy().to_string(), m.map(|m| m.len()).unwrap_or(0))
                })
                .collect();
            itens.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.to_lowercase().cmp(&b.1.to_lowercase())));
            let total = itens.len();
            let linhas: Vec<String> = itens
                .into_iter()
                .take(300)
                .map(|(d, n, t)| if d { format!("📁 {n}") } else { format!("📄 {n} ({})", tamanho(t)) })
                .collect();
            Ok(format!("{} ({} itens)\n{}", caminho.display(), total, linhas.join("\n")))
        }
        "ler" => {
            let meta = std::fs::metadata(&caminho).map_err(|e| e.to_string())?;
            if meta.len() > 2_000_000 {
                return Err("Arquivo grande demais para ler (máx. 2 MB).".into());
            }
            let bytes = std::fs::read(&caminho).map_err(|e| e.to_string())?;
            let texto = String::from_utf8_lossy(&bytes);
            let corte: String = texto.chars().take(60_000).collect();
            Ok(format!("<conteudo_externo arquivo=\"{}\">\n{}\n</conteudo_externo>", caminho.display(), corte))
        }
        "criar_pasta" => {
            std::fs::create_dir_all(&caminho).map_err(|e| e.to_string())?;
            Ok(format!("Pasta criada: {}", caminho.display()))
        }
        "mover" | "copiar" => {
            let destino_raw = expandir(&s(p, "destino"));
            if s(p, "destino").is_empty() {
                return Err("Informe o destino.".into());
            }
            let destino = if destino_raw.is_dir() { destino_raw.join(caminho.file_name().unwrap_or_default()) } else { destino_raw };
            if acao == "copiar" {
                copiar(&caminho, &destino)?;
                Ok(format!("Copiado para {}", destino.display()))
            } else {
                if std::fs::rename(&caminho, &destino).is_err() {
                    copiar(&caminho, &destino)?;
                    if caminho.is_dir() {
                        std::fs::remove_dir_all(&caminho).map_err(|e| e.to_string())?;
                    } else {
                        std::fs::remove_file(&caminho).map_err(|e| e.to_string())?;
                    }
                }
                Ok(format!("Movido para {}", destino.display()))
            }
        }
        "escrever" => {
            if let Some(dir) = caminho.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            std::fs::write(&caminho, s(p, "conteudo")).map_err(|e| e.to_string())?;
            Ok(format!("Arquivo salvo: {}", caminho.display()))
        }
        outra => Err(format!("Ação de arquivo desconhecida: {outra}")),
    }
}

fn copiar(de: &Path, para: &Path) -> Result<(), String> {
    if de.is_dir() {
        std::fs::create_dir_all(para).map_err(|e| e.to_string())?;
        for e in std::fs::read_dir(de).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            copiar(&e.path(), &para.join(e.file_name()))?;
        }
        Ok(())
    } else {
        std::fs::copy(de, para).map(|_| ()).map_err(|e| e.to_string())
    }
}

fn tamanho(b: u64) -> String {
    match b {
        b if b >= 1 << 30 => format!("{:.1} GB", b as f64 / (1u64 << 30) as f64),
        b if b >= 1 << 20 => format!("{:.1} MB", b as f64 / (1u64 << 20) as f64),
        b if b >= 1 << 10 => format!("{:.0} KB", b as f64 / 1024.0),
        b => format!("{b} B"),
    }
}

fn apagar(caminho: &str) -> Result<String, String> {
    let c = expandir(caminho);
    if !c.exists() {
        return Err(format!("Não encontrei {}", c.display()));
    }
    trash::delete(&c).map_err(|e| e.to_string())?;
    Ok(format!("Enviado para a Lixeira: {}", c.display()))
}

// ------------------------------------------------------------------ comando
async fn powershell(script: &str, timeout_s: u64) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(if cfg!(windows) { "powershell" } else { "sh" });
    if cfg!(windows) {
        cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; {script}")]);
    } else {
        cmd.args(["-c", script]);
    }
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd.kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(timeout_s), cmd.output())
        .await
        .map_err(|_| format!("O comando passou de {timeout_s} s e foi interrompido."))?
        .map_err(|e| e.to_string())?;
    let mut texto = String::from_utf8_lossy(&out.stdout).to_string();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        texto.push_str("\n[erro]\n");
        texto.push_str(&err);
    }
    let texto: String = texto.chars().take(20_000).collect();
    if out.status.success() {
        Ok(if texto.trim().is_empty() { "(sem saída)".into() } else { texto })
    } else {
        Err(format!("Saiu com código {:?}\n{texto}", out.status.code()))
    }
}

async fn comando(c: &str) -> Result<String, String> {
    if c.trim().is_empty() {
        return Err("Comando vazio.".into());
    }
    powershell(c, 110).await
}

async fn janelas() -> Result<String, String> {
    if cfg!(windows) {
        powershell(
            "Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object ProcessName | ForEach-Object { \"$($_.ProcessName) — $($_.MainWindowTitle)\" }",
            20,
        )
        .await
    } else {
        Ok("(lista de janelas disponível só no Windows)".into())
    }
}

// ------------------------------------------------------------------ tela
fn print(monitor: usize) -> Result<(String, Imagem), String> {
    let mut monitores = xcap::Monitor::all().map_err(|e| format!("não consegui acessar a tela: {e}"))?;
    if monitores.is_empty() {
        return Err("Nenhum monitor encontrado.".into());
    }
    // 0 = principal
    monitores.sort_by_key(|m| !m.is_primary().unwrap_or(false));
    let total = monitores.len();
    let m = monitores.get(monitor).ok_or(format!("Só há {total} monitor(es)."))?;
    let img = m.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = (img.width(), img.height());
    let escala = if w > LARGURA_MAX_PRINT { w as f64 / LARGURA_MAX_PRINT as f64 } else { 1.0 };
    let (nw, nh) = ((w as f64 / escala).round() as u32, (h as f64 / escala).round() as u32);
    let menor = image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Triangle);
    let rgb = image::DynamicImage::ImageRgba8(menor).to_rgb8();
    let mut jpg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 72).encode_image(&rgb).map_err(|e| e.to_string())?;
    *ULTIMO_PRINT.lock().unwrap() = Some(Geo { x: m.x().unwrap_or(0), y: m.y().unwrap_or(0), escala });
    Ok((
        format!("Print do monitor {monitor} de {total} ({nw}x{nh}). Coordenadas de pc_mouse são em pixels deste print."),
        Imagem { media_type: "image/jpeg".into(), data: base64::engine::general_purpose::STANDARD.encode(jpg) },
    ))
}

fn real(x: i64, y: i64) -> (i32, i32) {
    let g = ULTIMO_PRINT.lock().unwrap().unwrap_or(Geo { x: 0, y: 0, escala: 1.0 });
    (g.x + (x as f64 * g.escala).round() as i32, g.y + (y as f64 * g.escala).round() as i32)
}

fn verificar_parada() -> Result<(), String> {
    if PARAR.load(Ordering::SeqCst) {
        PARAR.store(false, Ordering::SeqCst);
        return Err("Interrompido pelo botão de pânico.".into());
    }
    Ok(())
}

fn mouse(p: &Value) -> Result<String, String> {
    use enigo::{Axis, Button, Coordinate, Direction, Enigo, Mouse, Settings};
    verificar_parada()?;
    let mut e = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let acao = s(p, "acao");
    if let (Some(x), Some(y)) = (i(p, "x"), i(p, "y")) {
        let (rx, ry) = real(x, y);
        e.move_mouse(rx, ry, Coordinate::Abs).map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(60));
    }
    match acao.as_str() {
        "clique" => e.button(Button::Left, Direction::Click),
        "duplo" => e.button(Button::Left, Direction::Click).and_then(|_| {
            std::thread::sleep(Duration::from_millis(70));
            e.button(Button::Left, Direction::Click)
        }),
        "direito" => e.button(Button::Right, Direction::Click),
        "mover" => Ok(()),
        "rolar" => e.scroll(i(p, "rolagem").unwrap_or(3) as i32, Axis::Vertical),
        outra => return Err(format!("Ação de mouse desconhecida: {outra}")),
    }
    .map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_millis(250));
    Ok(format!("Mouse: {acao} feito."))
}

fn tecla(nome: &str) -> Option<enigo::Key> {
    use enigo::Key;
    Some(match nome.trim().to_lowercase().as_str() {
        "ctrl" | "control" => Key::Control,
        "alt" => Key::Alt,
        "shift" => Key::Shift,
        "win" | "windows" | "meta" | "super" => Key::Meta,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "space" | "espaco" | "espaço" => Key::Space,
        "up" | "cima" => Key::UpArrow,
        "down" | "baixo" => Key::DownArrow,
        "left" | "esquerda" => Key::LeftArrow,
        "right" | "direita" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        o if o.chars().count() == 1 => Key::Unicode(o.chars().next()?),
        _ => return None,
    })
}

fn soltar_teclas() {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    if let Ok(mut e) = Enigo::new(&Settings::default()) {
        for k in [Key::Control, Key::Alt, Key::Shift, Key::Meta] {
            let _ = e.key(k, Direction::Release);
        }
    }
}

fn teclado(p: &Value) -> Result<String, String> {
    use enigo::{Direction, Enigo, Keyboard, Settings};
    verificar_parada()?;
    let mut e = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let texto = s(p, "texto");
    if !texto.is_empty() {
        e.text(&texto).map_err(|e| e.to_string())?;
    }
    let teclas: Vec<String> = p.get("teclas").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    for combo in &teclas {
        verificar_parada()?;
        let partes: Vec<&str> = combo.split('+').collect();
        let keys: Vec<enigo::Key> = partes.iter().map(|k| tecla(k).ok_or(format!("Tecla desconhecida: {k}"))).collect::<Result<_, _>>()?;
        let (ultima, mods) = keys.split_last().ok_or("atalho vazio")?;
        for m in mods {
            e.key(*m, Direction::Press).map_err(|e| e.to_string())?;
        }
        let r = e.key(*ultima, Direction::Click);
        for m in mods.iter().rev() {
            let _ = e.key(*m, Direction::Release);
        }
        r.map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(120));
    }
    std::thread::sleep(Duration::from_millis(200));
    Ok(format!(
        "Teclado: {}{}{}",
        if texto.is_empty() { String::new() } else { format!("digitei {} caracteres", texto.chars().count()) },
        if !texto.is_empty() && !teclas.is_empty() { " e " } else { "" },
        if teclas.is_empty() { String::new() } else { format!("pressionei {}", teclas.join(", ")) }
    ))
}

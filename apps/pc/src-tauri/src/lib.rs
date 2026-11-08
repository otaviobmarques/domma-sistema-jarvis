//! Jarvis by Domma Tecnologia — app de PC (Fase 2).
//! - Bandeja do sistema, inicia com o Windows, Ctrl+Espaço abre a caixa de comando
//! - Ctrl+Shift+Espaço: liga/desliga o Modo Conversa (falar em tempo real)
//! - Conexão permanente com o cérebro (long-polling) para executar ações no PC
mod acoes;
mod api;
mod audio;
mod config;
mod conversa;

use api::Api;
use base64::Engine;
use config::Config;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

struct AppState {
    config: Mutex<Config>,
    gravador: Mutex<audio::Gravador>,
    conversa: conversa::Conversa,
}

fn api(state: &AppState) -> Api {
    let c = state.config.lock().unwrap();
    Api::new(&c.servidor, c.token())
}

fn info_sistema() -> Value {
    json!({
        "os": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "versao_app": env!("CARGO_PKG_VERSION"),
        "nome_host": hostname::get().ok().and_then(|h| h.into_string().ok()),
    })
}

fn mostrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn alternar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            mostrar(app);
            let _ = app.emit("foco", ());
        }
    }
}

// ------------------------------------------------------------------ comandos da janela
#[tauri::command]
fn estado(state: State<'_, AppState>) -> Value {
    let c = state.config.lock().unwrap();
    json!({
        "pareado": c.device_id.is_some() && c.token().is_some(),
        "servidor": c.servidor,
        "nome": c.nome,
        "usuario": c.usuario,
        "privacidade": c.privacidade,
        "falar_respostas": c.falar_respostas,
        "versao": env!("CARGO_PKG_VERSION"),
    })
}

#[tauri::command]
async fn parear(state: State<'_, AppState>, servidor: String, codigo: String, nome: String) -> Result<String, String> {
    let servidor = if servidor.trim().is_empty() { config::SERVIDOR_PADRAO.to_string() } else { servidor.trim().trim_end_matches('/').to_string() };
    let r = Api::new(&servidor, None).parear(&codigo, &nome, info_sistema()).await?;
    let mut c = state.config.lock().unwrap();
    c.apagar_token();
    c.servidor = servidor;
    c.nome = nome;
    c.device_id = Some(r.device_id);
    c.usuario = Some(r.usuario.clone());
    c.salvar_token(&r.token)?;
    c.salvar()?;
    Ok(r.usuario)
}

#[tauri::command]
fn desparear(state: State<'_, AppState>) -> Result<(), String> {
    let mut c = state.config.lock().unwrap();
    c.apagar_token();
    c.device_id = None;
    c.usuario = None;
    c.salvar()
}

#[tauri::command]
async fn conversar(state: State<'_, AppState>, texto: String, voz: bool) -> Result<Value, String> {
    api(&state).chat(&texto, voz).await
}

#[tauri::command]
fn gravar_inicio(state: State<'_, AppState>) -> Result<(), String> {
    if state.config.lock().unwrap().privacidade {
        return Err("Modo privacidade ligado: o microfone está desligado.".into());
    }
    state.gravador.lock().unwrap().iniciar()
}

#[tauri::command]
async fn gravar_fim(state: State<'_, AppState>) -> Result<String, String> {
    let wav = state.gravador.lock().unwrap().parar()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(wav);
    api(&state).transcrever(b64, "audio/wav").await
}

#[tauri::command]
fn conversa_iniciar(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if state.config.lock().unwrap().privacidade {
        return Err("Modo privacidade ligado: o microfone está desligado.".into());
    }
    let nivel = state.gravador.lock().unwrap().nivel.clone();
    let app2 = app.clone();
    state.conversa.iniciar(app, nivel, move || {
        let st = app2.state::<AppState>();
        api(&st)
    })
}

#[tauri::command]
fn conversa_parar(state: State<'_, AppState>) {
    state.conversa.parar();
}

#[tauri::command]
fn conversa_modo(state: State<'_, AppState>, modo: String) {
    let m = match modo.as_str() {
        "pausado" => conversa::PAUSADO,
        "falando" => conversa::FALANDO,
        _ => conversa::OUVINDO,
    };
    state.conversa.modo.store(m, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
fn nivel_mic(state: State<'_, AppState>) -> f32 {
    f32::from_bits(state.gravador.lock().unwrap().nivel.load(std::sync::atomic::Ordering::Relaxed))
}

#[tauri::command]
fn tela_cheia(app: AppHandle, ligar: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("janela")?;
    w.set_fullscreen(ligar).map_err(|e| e.to_string())
}

#[tauri::command]
fn preferencias(state: State<'_, AppState>, privacidade: bool, falar_respostas: bool) -> Result<(), String> {
    let mut c = state.config.lock().unwrap();
    c.privacidade = privacidade;
    c.falar_respostas = falar_respostas;
    if privacidade {
        state.conversa.parar();
        let mut g = state.gravador.lock().unwrap();
        if g.gravando() {
            let _ = g.parar();
        }
    }
    c.salvar()
}

#[tauri::command]
async fn panico(state: State<'_, AppState>) -> Result<(), String> {
    acoes::PARAR.store(true, std::sync::atomic::Ordering::SeqCst);
    api(&state).panico().await
}

#[tauri::command]
async fn sintetizar(state: State<'_, AppState>, texto: String) -> Result<Value, String> {
    api(&state).post("/device/tts", json!({ "texto": texto })).await
}

#[tauri::command]
async fn conta(state: State<'_, AppState>) -> Result<Value, String> {
    api(&state).get("/device/me").await
}

#[tauri::command]
async fn retomar(state: State<'_, AppState>) -> Result<(), String> {
    api(&state).post("/device/resume", json!({})).await.map(|_| ())
}

/// Verifica se há versão nova. Devolve {atual, nova, url, notas, tem_nova}.
#[tauri::command]
async fn verificar_atualizacao(state: State<'_, AppState>) -> Result<Value, String> {
    let v = api(&state).get("/device/versao").await?;
    let atual = env!("CARGO_PKG_VERSION");
    let nova = v["versao"].as_str().unwrap_or(atual).to_string();
    let num = |s: &str| s.split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    Ok(json!({ "atual": atual, "nova": nova, "url": v["url"], "notas": v["notas"], "tem_nova": num(&nova) > num(atual) }))
}

#[tauri::command]
fn abrir_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("link inválido".into());
    }
    opener::open(url).map_err(|e| e.to_string())
}

#[tauri::command]
fn sair(app: AppHandle, state: State<'_, AppState>) {
    state.conversa.parar();
    app.exit(0);
}

#[tauri::command]
fn esconder(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

// ------------------------------------------------------------------ conexão com o cérebro
fn iniciar_conexao(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut primeira = true;
        loop {
            let st = app.state::<AppState>();
            let (cli, pareado) = {
                let c = st.config.lock().unwrap();
                (Api::new(&c.servidor, c.token()), c.device_id.is_some())
            };
            if !pareado || cli.token.is_none() {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
            match cli.poll(if primeira { Some(info_sistema()) } else { None }).await {
                Ok(Some(acao)) => {
                    primeira = false;
                    let _ = app.emit("conexao", "online");
                    let _ = app.emit("acao", json!({ "acao": acao.acao, "params": acao.params }));
                    let r = acoes::executar(&acao).await;
                    let _ = app.emit("acao_fim", json!({ "acao": acao.acao, "ok": r.ok }));
                    if let Err(e) = cli.resultado(&r).await {
                        log::warn!("falha ao enviar resultado: {e}");
                    }
                }
                Ok(None) => {
                    primeira = false;
                    let _ = app.emit("conexao", "online");
                }
                Err(e) if e == "nao_autorizado" => {
                    let _ = app.emit("conexao", "desconectado");
                    let mut c = st.config.lock().unwrap();
                    c.apagar_token();
                    c.device_id = None;
                    let _ = c.salvar();
                }
                Err(e) => {
                    log::warn!("sem conexão: {e}");
                    let _ = app.emit("conexao", "offline");
                    primeira = true;
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let atalho_abrir = Shortcut::new(Some(Modifiers::CONTROL), Code::Space);
    let atalho_falar = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--oculto"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, sc, ev| {
                    if ev.state() != ShortcutState::Pressed {
                        return;
                    }
                    if sc == &atalho_abrir {
                        alternar(app);
                    } else if sc == &atalho_falar {
                        mostrar(app);
                        let _ = app.emit("falar", ());
                    }
                })
                .build(),
        )
        .manage(AppState { config: Mutex::new(Config::carregar()), gravador: Mutex::new(audio::Gravador::novo()), conversa: conversa::Conversa::nova() })
        .invoke_handler(tauri::generate_handler![estado, parear, desparear, conversar, gravar_inicio, gravar_fim, conversa_iniciar, conversa_parar, conversa_modo, nivel_mic, tela_cheia, preferencias, panico, esconder, sintetizar, conta, retomar, verificar_atualizacao, abrir_link, sair])
        .setup(move |app| {
            // atalhos globais
            let gs = app.global_shortcut();
            if let Err(e) = gs.register(atalho_abrir) {
                log::warn!("Ctrl+Espaço indisponível: {e}");
            }
            if let Err(e) = gs.register(atalho_falar) {
                log::warn!("Ctrl+Shift+Espaço indisponível: {e}");
            }

            // inicia com o Windows
            {
                use tauri_plugin_autostart::ManagerExt;
                let al = app.autolaunch();
                if !al.is_enabled().unwrap_or(true) {
                    let _ = al.enable();
                }
            }

            // bandeja
            let abrir = MenuItem::with_id(app, "abrir", "Abrir Jarvis  (Ctrl+Espaço)", true, None::<&str>)?;
            let parar = MenuItem::with_id(app, "parar", "⛔ Parar tudo", true, None::<&str>)?;
            let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&abrir, &parar, &sep, &sair])?;
            TrayIconBuilder::with_id("jarvis")
                .icon(app.default_window_icon().cloned().expect("ícone"))
                .tooltip("Jarvis by Domma Tecnologia")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "abrir" => mostrar(app),
                    "parar" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let st = app.state::<AppState>();
                            acoes::PARAR.store(true, std::sync::atomic::Ordering::SeqCst);
                            let _ = api(&st).panico().await;
                            let _ = app.emit("parado", ());
                        });
                    }
                    "sair" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        alternar(tray.app_handle());
                    }
                })
                .build(app)?;

            // começa escondido quando iniciado com o Windows e já pareado
            let oculto = std::env::args().any(|a| a == "--oculto");
            let pareado = app.state::<AppState>().config.lock().unwrap().device_id.is_some();
            if oculto && pareado {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            iniciar_conexao(app.handle().clone());
            Ok(())
        })
        .on_window_event(|w, ev| {
            // fechar a janela só esconde: o Jarvis continua na bandeja
            if let WindowEvent::CloseRequested { api, .. } = ev {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Jarvis");
}

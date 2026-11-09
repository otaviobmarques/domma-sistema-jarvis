//! Palavra de ativação ("Tavinho") reconhecida 100% no PC, com o Vosk (offline).
//!
//! O Vosk roda com uma gramática fechada: só reconhece "tá vinho" (é como o modelo
//! pequeno em português ouve "Tavinho") e algumas palavras parecidas que servem de
//! "isca" para não disparar à toa ("otávio", "vinho"). Nada sai do PC até a palavra
//! ser reconhecida; depois disso o trecho falado segue o caminho normal da conversa.
//!
//! A biblioteca (libvosk) é carregada em tempo de execução: se os arquivos não
//! estiverem instalados, o app funciona normalmente, só sem a palavra de ativação.
use libloading::{Library, Symbol};
use serde::Deserialize;
use std::ffi::{c_char, c_float, c_int, c_short, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

// Iscas escolhidas testando frases reais: sem elas, "tá vindo", "estava indo" e "Gustavinho" disparavam.
const GRAMATICA: &str = r#"["tá vinho", "ta vinho", "otávio", "vinho", "tá vindo", "vindo", "tá vendo", "vendo", "tá bom", "gustavo", "fabinho", "tavares", "[unk]"]"#;
pub const TAXA: u32 = 16_000;

type FnModelNew = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type FnRecNewGrm = unsafe extern "C" fn(*mut c_void, c_float, *const c_char) -> *mut c_void;
type FnRecSetWords = unsafe extern "C" fn(*mut c_void, c_int);
type FnRecAccept = unsafe extern "C" fn(*mut c_void, *const c_short, c_int) -> c_int;
type FnRecResult = unsafe extern "C" fn(*mut c_void) -> *const c_char;
type FnRecFree = unsafe extern "C" fn(*mut c_void);
type FnLogLevel = unsafe extern "C" fn(c_int);

pub struct Vosk {
    lib: Library,
    modelo: *mut c_void,
}
// O modelo do Vosk pode ser compartilhado entre threads; cada reconhecedor é usado por uma só.
unsafe impl Send for Vosk {}
unsafe impl Sync for Vosk {}

static VOSK: OnceLock<Option<Arc<Vosk>>> = OnceLock::new();

/// Carrega (uma vez) a biblioteca e o modelo que vêm junto com o instalador.
pub fn carregar(recursos: &Path) -> Option<Arc<Vosk>> {
    VOSK.get_or_init(|| match Vosk::abrir(&recursos.join("vosk")) {
        Ok(v) => {
            log::info!("palavra de ativação: Vosk carregado");
            Some(Arc::new(v))
        }
        Err(e) => {
            log::warn!("palavra de ativação indisponível: {e}");
            None
        }
    })
    .clone()
}

impl Vosk {
    fn abrir(dir: &Path) -> Result<Vosk, String> {
        #[cfg(windows)]
        let nome_lib = "libvosk.dll";
        #[cfg(not(windows))]
        let nome_lib = "libvosk.so";
        let caminho_lib = dir.join(nome_lib);
        if !caminho_lib.exists() {
            return Err(format!("{} não encontrado", caminho_lib.display()));
        }
        let lib = unsafe { abrir_lib(&caminho_lib) }.map_err(|e| format!("não carregou a libvosk: {e}"))?;
        let modelo_dir = caminho_ascii(&dir.join("modelo"))?;
        let c = CString::new(modelo_dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let modelo = unsafe {
            let log: Symbol<FnLogLevel> = lib.get(b"vosk_set_log_level\0").map_err(|e| e.to_string())?;
            log(-1);
            let novo: Symbol<FnModelNew> = lib.get(b"vosk_model_new\0").map_err(|e| e.to_string())?;
            novo(c.as_ptr())
        };
        if modelo.is_null() {
            return Err(format!("não carregou o modelo em {}", modelo_dir.display()));
        }
        Ok(Vosk { lib, modelo })
    }

    pub fn detector(self: &Arc<Self>) -> Result<Detector, String> {
        let g = CString::new(GRAMATICA).unwrap();
        let rec = unsafe {
            let novo: Symbol<FnRecNewGrm> = self.lib.get(b"vosk_recognizer_new_grm\0").map_err(|e| e.to_string())?;
            let r = novo(self.modelo, TAXA as c_float, g.as_ptr());
            if !r.is_null() {
                let palavras: Symbol<FnRecSetWords> = self.lib.get(b"vosk_recognizer_set_words\0").map_err(|e| e.to_string())?;
                palavras(r, 1);
            }
            r
        };
        if rec.is_null() {
            return Err("não criou o reconhecedor".into());
        }
        Ok(Detector { vosk: self.clone(), rec, amostras: 0 })
    }
}

#[cfg(windows)]
unsafe fn abrir_lib(p: &Path) -> Result<Library, libloading::Error> {
    // As dependências (libstdc++, libgcc, winpthread) estão na mesma pasta da DLL.
    const LOAD_WITH_ALTERED_SEARCH_PATH: u32 = 0x0000_0008;
    libloading::os::windows::Library::load_with_flags(p, LOAD_WITH_ALTERED_SEARCH_PATH).map(Into::into)
}
#[cfg(not(windows))]
unsafe fn abrir_lib(p: &Path) -> Result<Library, libloading::Error> {
    Library::new(p)
}

/// O Vosk abre o modelo com um caminho "estreito" (char*): no Windows, um caminho com
/// acento (ex.: C:\Users\Otávio\...) falha. Nesse caso, copia o modelo uma vez para uma
/// pasta só com ASCII.
fn caminho_ascii(dir: &Path) -> Result<PathBuf, String> {
    if dir.to_string_lossy().is_ascii() {
        return Ok(dir.to_path_buf());
    }
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let destino = base.join("Tavinho").join("vosk-modelo");
    if !destino.to_string_lossy().is_ascii() {
        return Err("não há pasta sem acentos para o modelo de voz".into());
    }
    if !destino.join("final.mdl").exists() {
        copiar_dir(dir, &destino).map_err(|e| format!("não copiou o modelo de voz: {e}"))?;
    }
    Ok(destino)
}

fn copiar_dir(de: &Path, para: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(para)?;
    for e in std::fs::read_dir(de)? {
        let e = e?;
        let alvo = para.join(e.file_name());
        if e.file_type()?.is_dir() {
            copiar_dir(&e.path(), &alvo)?;
        } else {
            std::fs::copy(e.path(), alvo)?;
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct Resultado {
    #[serde(default)]
    result: Vec<Palavra>,
}
#[derive(Deserialize)]
struct Palavra {
    word: String,
    conf: f32,
    end: f32,
}

/// Reconhecedor de um fluxo de áudio a 16 kHz.
pub struct Detector {
    vosk: Arc<Vosk>,
    rec: *mut c_void,
    amostras: u64,
}
unsafe impl Send for Detector {}

impl Detector {
    /// Amostras a 16 kHz recebidas desde que o detector foi criado.
    pub fn amostras(&self) -> u64 {
        self.amostras
    }

    /// Alimenta áudio (16 kHz, mono). Quando ouvir "Tavinho", devolve em que amostra
    /// (contada desde a criação) a palavra terminou.
    pub fn alimentar(&mut self, audio: &[i16]) -> Option<u64> {
        if audio.is_empty() {
            return None;
        }
        self.amostras += audio.len() as u64;
        let fim_frase = unsafe {
            let aceitar: Symbol<FnRecAccept> = self.vosk.lib.get(b"vosk_recognizer_accept_waveform_s\0").ok()?;
            aceitar(self.rec, audio.as_ptr(), audio.len() as c_int)
        };
        if fim_frase != 1 {
            return None;
        }
        let json = unsafe {
            let resultado: Symbol<FnRecResult> = self.vosk.lib.get(b"vosk_recognizer_result\0").ok()?;
            let p = resultado(self.rec);
            if p.is_null() {
                return None;
            }
            CStr::from_ptr(p).to_string_lossy().into_owned()
        };
        achar_palavra(&json).map(|fim| (fim * TAXA as f32) as u64)
    }
}

impl Drop for Detector {
    fn drop(&mut self) {
        unsafe {
            if let Ok(liberar) = self.vosk.lib.get::<FnRecFree>(b"vosk_recognizer_free\0") {
                liberar(self.rec);
            }
        }
    }
}

/// Procura "tá vinho" (duas palavras seguidas) com confiança suficiente; devolve o fim, em segundos.
fn achar_palavra(json: &str) -> Option<f32> {
    let r: Resultado = serde_json::from_str(json).ok()?;
    r.result.windows(2).find_map(|par| {
        let ta = matches!(par[0].word.as_str(), "tá" | "ta");
        (ta && par[1].word == "vinho" && par[0].conf >= 0.4 && par[1].conf >= 0.85).then_some(par[1].end)
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn reconhece_so_ta_vinho() {
        let ok = r#"{"result":[{"word":"[unk]","conf":0.8,"start":0,"end":0.06},{"word":"tá","conf":0.5,"start":0.07,"end":0.33},{"word":"vinho","conf":1.0,"start":0.33,"end":0.93}],"text":"[unk] tá vinho"}"#;
        assert_eq!(achar_palavra(ok), Some(0.93));
        let vinho = r#"{"result":[{"word":"[unk]","conf":0.8,"start":0.6,"end":1.1},{"word":"vinho","conf":1.0,"start":1.2,"end":1.7}],"text":"[unk] vinho"}"#;
        assert_eq!(achar_palavra(vinho), None);
        let otavio = r#"{"result":[{"word":"otávio","conf":1.0,"start":0.06,"end":0.93},{"word":"vinho","conf":0.87,"start":1.2,"end":1.6}],"text":"otávio vinho"}"#;
        assert_eq!(achar_palavra(otavio), None);
        let fraco = r#"{"result":[{"word":"tá","conf":0.3,"start":0.0,"end":0.3},{"word":"vinho","conf":0.6,"start":0.3,"end":0.9}],"text":"tá vinho"}"#;
        assert_eq!(achar_palavra(fraco), None);
    }

    /// Teste com a biblioteca de verdade: VOSK_DIR=<pasta com libvosk + modelo/> e VOSK_WAVS=a.wav:1,b.wav:0
    #[test]
    fn com_audio_real() {
        let (Ok(dir), Ok(wavs)) = (std::env::var("VOSK_DIR"), std::env::var("VOSK_WAVS")) else { return };
        let v = Arc::new(Vosk::abrir(Path::new(&dir)).expect("abrir vosk"));
        let mut erros = vec![];
        for item in wavs.split(',') {
            let (arq, esperado) = item.rsplit_once(':').unwrap();
            let mut r = hound::WavReader::open(arq).unwrap();
            let a: Vec<i16> = r.samples::<i16>().map(|s| s.unwrap()).collect();
            let mut d = v.detector().unwrap();
            let mut achou = None;
            for bloco in a.chunks(480).chain(std::iter::once(&[0i16; 16000][..])) {
                if let Some(f) = d.alimentar(bloco) {
                    achou = Some(f);
                }
            }
            println!("{arq}: {achou:?}");
            if achou.is_some() != (esperado == "1") {
                erros.push(arq.to_string());
            }
        }
        assert!(erros.is_empty(), "erros: {erros:?}");
    }
}

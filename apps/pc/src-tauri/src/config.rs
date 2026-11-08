//! Configuração local do app. O token do dispositivo fica no Gerenciador de
//! Credenciais do Windows (keyring), nunca em arquivo.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const SERVIDOR_PADRAO: &str = "https://jarvis.dommasistemas.com.br";
const SERVICO_KEYRING: &str = "Jarvis by Domma";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub servidor: String,
    pub device_id: Option<String>,
    pub nome: String,
    pub usuario: Option<String>,
    #[serde(default)]
    pub privacidade: bool,
    #[serde(default)]
    pub falar_respostas: bool,
}

fn caminho() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    base.join("Jarvis").join("config.json")
}

impl Config {
    pub fn carregar() -> Config {
        let mut c: Config = std::fs::read_to_string(caminho())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if c.servidor.is_empty() {
            c.servidor = SERVIDOR_PADRAO.to_string();
        }
        if c.nome.is_empty() {
            c.nome = hostname::get()
                .ok()
                .and_then(|h| h.into_string().ok())
                .unwrap_or_else(|| "Meu PC".into());
        }
        c
    }

    pub fn salvar(&self) -> Result<(), String> {
        let p = caminho();
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(p, serde_json::to_string_pretty(self).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }

    pub fn token(&self) -> Option<String> {
        let id = self.device_id.as_ref()?;
        keyring::Entry::new(SERVICO_KEYRING, id).ok()?.get_password().ok()
    }

    pub fn salvar_token(&self, token: &str) -> Result<(), String> {
        let id = self.device_id.as_ref().ok_or("sem device_id")?;
        keyring::Entry::new(SERVICO_KEYRING, id)
            .map_err(|e| e.to_string())?
            .set_password(token)
            .map_err(|e| format!("não consegui guardar o token no Windows: {e}"))
    }

    pub fn apagar_token(&self) {
        if let Some(id) = &self.device_id {
            if let Ok(e) = keyring::Entry::new(SERVICO_KEYRING, id) {
                let _ = e.delete_credential();
            }
        }
    }
}

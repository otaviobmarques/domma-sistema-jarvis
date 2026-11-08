//! Cliente HTTP do cérebro do Jarvis (rotas /device/*).
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub struct Api {
    http: reqwest::Client,
    pub servidor: String,
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Pareado {
    pub device_id: String,
    pub token: String,
    pub usuario: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Acao {
    pub id: String,
    pub acao: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Imagem {
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Serialize)]
pub struct Resultado {
    pub id: String,
    pub ok: bool,
    pub texto: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imagem: Option<Imagem>,
}

async fn erro_de(res: reqwest::Response) -> String {
    let status = res.status();
    let corpo: Value = res.json().await.unwrap_or(json!({}));
    corpo["error"].as_str().map(String::from).unwrap_or_else(|| format!("servidor respondeu {status}"))
}

impl Api {
    pub fn new(servidor: &str, token: Option<String>) -> Api {
        Api {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(600))
                .user_agent(concat!("JarvisPC/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("cliente http"),
            servidor: servidor.trim_end_matches('/').to_string(),
            token,
        }
    }

    fn url(&self, p: &str) -> String {
        format!("{}{}", self.servidor, p)
    }

    fn auth(&self, rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.token {
            Some(t) => rb.bearer_auth(t),
            None => rb,
        }
    }

    pub async fn parear(&self, codigo: &str, nome: &str, info: Value) -> Result<Pareado, String> {
        let res = self
            .http
            .post(self.url("/device/pair"))
            .json(&json!({ "codigo": codigo, "nome": nome, "tipo": "pc", "info": info }))
            .send()
            .await
            .map_err(|e| format!("não consegui falar com {}: {e}", self.servidor))?;
        if !res.status().is_success() {
            return Err(erro_de(res).await);
        }
        res.json().await.map_err(|e| e.to_string())
    }

    /// Long-poll: devolve a próxima ação (ou None depois de ~25 s).
    pub async fn poll(&self, info: Option<Value>) -> Result<Option<Acao>, String> {
        let res = self
            .auth(self.http.post(self.url("/device/poll")))
            .timeout(Duration::from_secs(40))
            .json(&json!({ "info": info }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if res.status().as_u16() == 401 {
            return Err("nao_autorizado".into());
        }
        if !res.status().is_success() {
            return Err(erro_de(res).await);
        }
        let v: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(serde_json::from_value(v["acao"].clone()).ok())
    }

    pub async fn resultado(&self, r: &Resultado) -> Result<(), String> {
        let res = self.auth(self.http.post(self.url("/device/result"))).json(r).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(erro_de(res).await);
        }
        Ok(())
    }

    pub async fn transcrever(&self, audio_b64: String, mime: &str) -> Result<String, String> {
        let res = self
            .auth(self.http.post(self.url("/device/transcribe")))
            .json(&json!({ "audio": audio_b64, "mime": mime }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(erro_de(res).await);
        }
        let v: Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(v["texto"].as_str().unwrap_or("").to_string())
    }

    pub async fn chat(&self, texto: &str, voz: bool) -> Result<Value, String> {
        let res = self
            .auth(self.http.post(self.url("/device/chat")))
            .json(&json!({ "texto": texto, "voz": voz }))
            .send()
            .await
            .map_err(|e| format!("sem conexão com o Jarvis: {e}"))?;
        if !res.status().is_success() {
            return Err(erro_de(res).await);
        }
        res.json().await.map_err(|e| e.to_string())
    }

    pub async fn panico(&self) -> Result<(), String> {
        let res = self.auth(self.http.post(self.url("/device/panic"))).json(&json!({})).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(erro_de(res).await);
        }
        Ok(())
    }
}

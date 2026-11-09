//! Modo Conversa: microfone aberto com detecção de voz (VAD) local.
//! Detecta quando a pessoa começa e termina de falar, transcreve só o trecho
//! falado e entrega o texto para a janela. Enquanto o Jarvis fala, continua
//! ouvindo com limiar mais alto para permitir interromper ("barge-in").
use crate::api::Api;
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::json;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const OUVINDO: u8 = 0;
pub const PAUSADO: u8 = 1; // pensando: ignora o microfone
pub const FALANDO: u8 = 2; // Jarvis falando: só uma voz forte interrompe

pub struct Conversa {
    ativo: Arc<AtomicBool>,
    pub modo: Arc<AtomicU8>,
}

impl Conversa {
    pub fn nova() -> Conversa {
        Conversa { ativo: Arc::new(AtomicBool::new(false)), modo: Arc::new(AtomicU8::new(OUVINDO)) }
    }

    pub fn ativa(&self) -> bool {
        self.ativo.load(Ordering::SeqCst)
    }

    pub fn parar(&self) {
        self.ativo.store(false, Ordering::SeqCst);
    }

    /// `nova_api` cria o cliente do cérebro (lê servidor/token atuais).
    pub fn iniciar(&self, app: AppHandle, nivel: Arc<AtomicU32>, nova_api: impl Fn() -> Api + Send + 'static) -> Result<(), String> {
        if self.ativa() {
            return Ok(());
        }
        self.ativo.store(true, Ordering::SeqCst);
        self.modo.store(OUVINDO, Ordering::SeqCst);
        let (ativo, modo) = (self.ativo.clone(), self.modo.clone());
        let (tx, rx) = mpsc::channel::<Vec<f32>>();
        let (tx_ok, rx_ok) = mpsc::channel::<Result<u32, String>>();

        // thread do microfone (o stream do cpal não é Send)
        let ativo_mic = ativo.clone();
        std::thread::spawn(move || {
            let r = (|| -> Result<(cpal::Stream, u32), String> {
                let dev = cpal::default_host().default_input_device().ok_or("Nenhum microfone encontrado.")?;
                let cfg = dev.default_input_config().map_err(|e| e.to_string())?;
                let canais = cfg.channels() as usize;
                let taxa = cfg.sample_rate().0;
                let err = |e| log::warn!("microfone: {e}");
                let stream = match cfg.sample_format() {
                    cpal::SampleFormat::F32 => {
                        let tx = tx.clone();
                        dev.build_input_stream(&cfg.into(), move |d: &[f32], _: &_| {
                            let _ = tx.send(d.chunks(canais).map(|c| c.iter().sum::<f32>() / canais as f32).collect());
                        }, err, None)
                    }
                    cpal::SampleFormat::I16 => {
                        let tx = tx.clone();
                        dev.build_input_stream(&cfg.into(), move |d: &[i16], _: &_| {
                            let _ = tx.send(d.chunks(canais).map(|c| c.iter().map(|&x| x as f32 / 32768.0).sum::<f32>() / canais as f32).collect());
                        }, err, None)
                    }
                    cpal::SampleFormat::U16 => {
                        let tx = tx.clone();
                        dev.build_input_stream(&cfg.into(), move |d: &[u16], _: &_| {
                            let _ = tx.send(d.chunks(canais).map(|c| c.iter().map(|&x| (x as f32 - 32768.0) / 32768.0).sum::<f32>() / canais as f32).collect());
                        }, err, None)
                    }
                    f => return Err(format!("Formato de áudio não suportado: {f:?}")),
                }
                .map_err(|e| e.to_string())?;
                stream.play().map_err(|e| e.to_string())?;
                Ok((stream, taxa))
            })();
            match r {
                Ok((stream, taxa)) => {
                    let _ = tx_ok.send(Ok(taxa));
                    while ativo_mic.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    drop(stream);
                }
                Err(e) => {
                    ativo_mic.store(false, Ordering::SeqCst);
                    let _ = tx_ok.send(Err(e));
                }
            }
        });
        let taxa = rx_ok.recv_timeout(Duration::from_secs(5)).map_err(|_| "o microfone não respondeu".to_string())??;

        // thread do detector de voz
        std::thread::spawn(move || {
            let quadro = (taxa as usize / 1000) * 30; // 30 ms
            let pre_roll = (taxa as usize / 1000) * 350;
            let mut buf: Vec<f32> = Vec::new();
            let mut anteriores: Vec<f32> = Vec::new(); // áudio antes do início da fala
            let mut fala: Vec<f32> = Vec::new();
            let mut falando = false;
            let mut voz_ms = 0u32;
            let mut silencio_ms = 0u32;
            let mut ruido = 0.008f32; // piso de ruído adaptativo
            let mut inicio = Instant::now();

            while ativo.load(Ordering::SeqCst) {
                let Ok(bloco) = rx.recv_timeout(Duration::from_millis(200)) else { continue };
                buf.extend(bloco);
                while buf.len() >= quadro {
                    let q: Vec<f32> = buf.drain(..quadro).collect();
                    let rms = (q.iter().map(|x| x * x).sum::<f32>() / q.len() as f32).sqrt();
                    nivel.store((rms * 4.0).min(1.0).to_bits(), Ordering::Relaxed);
                    let m = modo.load(Ordering::SeqCst);
                    if m == PAUSADO {
                        falando = false;
                        fala.clear();
                        anteriores.clear();
                        continue;
                    }
                    let limiar = (ruido * 3.2).max(0.018) * if m == FALANDO { 2.6 } else { 1.0 };
                    let e_voz = rms > limiar;
                    if !falando {
                        if !e_voz {
                            ruido = ruido * 0.97 + rms * 0.03; // aprende o ruído ambiente
                        }
                        anteriores.extend(&q);
                        if anteriores.len() > pre_roll {
                            let sobra = anteriores.len() - pre_roll;
                            anteriores.drain(..sobra);
                        }
                        voz_ms = if e_voz { voz_ms + 30 } else { 0 };
                        if voz_ms >= 150 {
                            falando = true;
                            silencio_ms = 0;
                            inicio = Instant::now();
                            fala = std::mem::take(&mut anteriores);
                            if m == FALANDO {
                                let _ = app.emit("conversa_interrompeu", ());
                                modo.store(OUVINDO, Ordering::SeqCst);
                            }
                            let _ = app.emit("conversa_ouvindo", ());
                        }
                    } else {
                        fala.extend(&q);
                        silencio_ms = if e_voz { 0 } else { silencio_ms + 30 };
                        let longa = inicio.elapsed().as_secs() >= 25;
                        if silencio_ms >= 550 || longa {
                            falando = false;
                            voz_ms = 0;
                            let trecho = std::mem::take(&mut fala);
                            if trecho.len() > taxa as usize / 2 {
                                modo.store(PAUSADO, Ordering::SeqCst);
                                let _ = app.emit("conversa_processando", ());
                                let api = nova_api();
                                let app2 = app.clone();
                                let modo2 = modo.clone();
                                let (amostras16, taxa16) = reamostrar_16k(&trecho, taxa);
                                let wav = para_wav(&amostras16, taxa16);
                                tauri::async_runtime::spawn(async move {
                                    let b64 = base64::engine::general_purpose::STANDARD.encode(wav);
                                    match api.transcrever(b64, "audio/wav").await {
                                        Ok(t) if util(&t) => {
                                            let _ = app2.emit("conversa_texto", json!({ "texto": t.trim() }));
                                        }
                                        Ok(_) => {
                                            modo2.store(OUVINDO, Ordering::SeqCst);
                                            let _ = app2.emit("conversa_retomou", ());
                                        }
                                        Err(e) => {
                                            modo2.store(OUVINDO, Ordering::SeqCst);
                                            let _ = app2.emit("conversa_erro", e);
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
            }
            nivel.store(0, Ordering::Relaxed);
            let _ = app.emit("conversa_fim", ());
        });
        Ok(())
    }
}

/// Descarta transcrições vazias e "alucinações" típicas do Whisper em silêncio/ruído.
fn util(t: &str) -> bool {
    let l = t.trim().to_lowercase();
    if l.chars().filter(|c| c.is_alphanumeric()).count() < 2 {
        return false;
    }
    const RUIDO: [&str; 8] = ["legendas pela comunidade", "amara.org", "obrigado por assistir", "inscreva-se", "legendado por", "transcrição por", "música", "♪"];
    !RUIDO.iter().any(|r| l.contains(r))
}

/// Reduz para 16 kHz (o que o Whisper usa): áudio 3x menor, envio mais rápido.
fn reamostrar_16k(a: &[f32], taxa: u32) -> (Vec<f32>, u32) {
    if taxa <= 16000 {
        return (a.to_vec(), taxa);
    }
    let passo = taxa as f64 / 16000.0;
    let n = (a.len() as f64 / passo) as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let ini = (i as f64 * passo) as usize;
        let fim = (((i + 1) as f64 * passo) as usize).min(a.len());
        let janela = &a[ini..fim.max(ini + 1).min(a.len())];
        out.push(janela.iter().sum::<f32>() / janela.len().max(1) as f32);
    }
    (out, 16000)
}

fn para_wav(amostras: &[f32], taxa: u32) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    {
        let spec = hound::WavSpec { channels: 1, sample_rate: taxa, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        if let Ok(mut w) = hound::WavWriter::new(&mut buf, spec) {
            for s in amostras {
                let _ = w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16);
            }
            let _ = w.finalize();
        }
    }
    buf.into_inner()
}

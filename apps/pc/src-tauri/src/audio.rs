//! Gravação do microfone (aperte para falar). O áudio vira WAV mono e é
//! transcrito no cérebro (Fase 2.2 trará transcrição local + palavra de ativação).
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};

pub struct Gravador {
    parar: Arc<AtomicBool>,
    amostras: Arc<Mutex<Vec<f32>>>,
    taxa: Arc<Mutex<u32>>,
    fim: Option<mpsc::Receiver<Result<(), String>>>,
}

impl Gravador {
    pub fn novo() -> Gravador {
        Gravador { parar: Arc::new(AtomicBool::new(false)), amostras: Arc::default(), taxa: Arc::new(Mutex::new(16000)), fim: None }
    }

    pub fn gravando(&self) -> bool {
        self.fim.is_some()
    }

    pub fn iniciar(&mut self) -> Result<(), String> {
        if self.fim.is_some() {
            return Ok(());
        }
        self.parar.store(false, Ordering::SeqCst);
        self.amostras.lock().unwrap().clear();
        let (parar, amostras, taxa) = (self.parar.clone(), self.amostras.clone(), self.taxa.clone());
        let (tx_ok, rx_ok) = mpsc::channel::<Result<(), String>>();
        let (tx_fim, rx_fim) = mpsc::channel::<Result<(), String>>();

        // O stream do cpal não é Send: vive numa thread própria.
        std::thread::spawn(move || {
            let r = (|| -> Result<cpal::Stream, String> {
                let host = cpal::default_host();
                let dev = host.default_input_device().ok_or("Nenhum microfone encontrado.")?;
                let cfg = dev.default_input_config().map_err(|e| e.to_string())?;
                let canais = cfg.channels() as usize;
                *taxa.lock().unwrap() = cfg.sample_rate().0;
                let err = |e| log::warn!("erro no microfone: {e}");
                let a = amostras.clone();
                let stream = match cfg.sample_format() {
                    cpal::SampleFormat::F32 => dev.build_input_stream(
                        &cfg.into(),
                        move |d: &[f32], _: &_| {
                            let mut v = a.lock().unwrap();
                            v.extend(d.chunks(canais).map(|c| c.iter().sum::<f32>() / canais as f32));
                        },
                        err,
                        None,
                    ),
                    cpal::SampleFormat::I16 => dev.build_input_stream(
                        &cfg.into(),
                        move |d: &[i16], _: &_| {
                            let mut v = a.lock().unwrap();
                            v.extend(d.chunks(canais).map(|c| c.iter().map(|&x| x as f32 / 32768.0).sum::<f32>() / canais as f32));
                        },
                        err,
                        None,
                    ),
                    cpal::SampleFormat::U16 => dev.build_input_stream(
                        &cfg.into(),
                        move |d: &[u16], _: &_| {
                            let mut v = a.lock().unwrap();
                            v.extend(d.chunks(canais).map(|c| c.iter().map(|&x| (x as f32 - 32768.0) / 32768.0).sum::<f32>() / canais as f32));
                        },
                        err,
                        None,
                    ),
                    f => return Err(format!("Formato de áudio não suportado: {f:?}")),
                }
                .map_err(|e| e.to_string())?;
                stream.play().map_err(|e| e.to_string())?;
                Ok(stream)
            })();
            match r {
                Ok(stream) => {
                    let _ = tx_ok.send(Ok(()));
                    // máximo de 2 minutos
                    let inicio = std::time::Instant::now();
                    while !parar.load(Ordering::SeqCst) && inicio.elapsed().as_secs() < 120 {
                        std::thread::sleep(std::time::Duration::from_millis(30));
                    }
                    drop(stream);
                    let _ = tx_fim.send(Ok(()));
                }
                Err(e) => {
                    let _ = tx_ok.send(Err(e.clone()));
                    let _ = tx_fim.send(Err(e));
                }
            }
        });
        rx_ok.recv().map_err(|e| e.to_string())??;
        self.fim = Some(rx_fim);
        Ok(())
    }

    /// Para e devolve o WAV (16 bits, mono).
    pub fn parar(&mut self) -> Result<Vec<u8>, String> {
        let fim = self.fim.take().ok_or("Não estava gravando.")?;
        self.parar.store(true, Ordering::SeqCst);
        fim.recv().map_err(|e| e.to_string())??;
        let amostras = std::mem::take(&mut *self.amostras.lock().unwrap());
        let taxa = *self.taxa.lock().unwrap();
        if amostras.len() < (taxa as usize / 3) {
            return Err("Não captei nada. Segure um pouco mais.".into());
        }
        let mut buf = Cursor::new(Vec::new());
        {
            let spec = hound::WavSpec { channels: 1, sample_rate: taxa, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
            let mut w = hound::WavWriter::new(&mut buf, spec).map_err(|e| e.to_string())?;
            for s in amostras {
                w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).map_err(|e| e.to_string())?;
            }
            w.finalize().map_err(|e| e.to_string())?;
        }
        Ok(buf.into_inner())
    }
}

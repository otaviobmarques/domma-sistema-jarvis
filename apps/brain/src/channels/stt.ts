import { config } from "../lib/config.js";

/** Transcrição de áudio na nuvem (endpoint compatível com /audio/transcriptions, ex.: Groq Whisper). */
export async function transcribe(audio: Buffer, mime = "audio/ogg", dica = ""): Promise<string> {
  if (!config.stt.apiKey) throw new Error("Transcrição de áudio não configurada (STT_API_KEY).");
  const form = new FormData();
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("webm") ? "webm" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : "mp3";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime.split(";")[0] }), `audio.${ext}`);
  form.append("model", config.stt.model);
  form.append("language", "pt");
  form.append("response_format", "json");
  // vocabulário esperado: ajuda o Whisper a acertar nomes próprios
  form.append("prompt", `${dica ? dica + ". " : ""}Tavinho. Jarvis. Domma. Master Laudo. RedBox. Auto Visão.`);
  const res = await fetch(config.stt.url, { method: "POST", headers: { authorization: `Bearer ${config.stt.apiKey}` }, body: form });
  if (!res.ok) throw new Error(`Transcrição falhou: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}

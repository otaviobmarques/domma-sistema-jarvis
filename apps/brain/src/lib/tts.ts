/**
 * Voz natural (ElevenLabs). A chave é cadastrada no painel (Integrações → Voz natural).
 * Modelo "turbo" multilíngue: boa naturalidade em português com baixa latência.
 */
export const tts = {
  apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  voiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  model: process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5",
};

const API = "https://api.elevenlabs.io/v1";

export function ttsConfigurado() {
  return !!tts.apiKey;
}

/** Limpa o texto para soar natural: sem markdown, sem URLs longas. */
function falavel(t: string) {
  return t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/https?:\/\/\S+/g, "o link")
    .replace(/[#_`>|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .trim()
    .slice(0, 2500);
}

export async function sintetizar(texto: string): Promise<{ audio: Buffer; mime: string }> {
  if (!tts.apiKey) throw new Error("Voz natural não configurada (Integrações → Voz natural).");
  const voz = tts.voiceId || (await vozPadrao());
  const res = await fetch(`${API}/text-to-speech/${voz}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": tts.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: falavel(texto),
      model_id: tts.model,
      language_code: "pt",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.05 },
    }),
  });
  if (!res.ok) throw new Error(`Voz: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
}

let cachePadrao: string | null = null;
async function vozPadrao() {
  if (cachePadrao) return cachePadrao;
  const vozes = await listarVozes();
  // preferência: voz masculina e calma da biblioteca padrão; senão a primeira
  cachePadrao = vozes.find((v) => /brian|daniel|george|adam|eric|chris/i.test(v.nome))?.id ?? vozes[0]?.id ?? "nPczCjzI2devNBz1zQrb";
  return cachePadrao;
}

export async function listarVozes(apiKey = tts.apiKey): Promise<{ id: string; nome: string; descricao: string; preview: string | null }[]> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(res.status === 401 ? "Chave da ElevenLabs inválida" : `ElevenLabs: ${res.status}`);
  const body = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string }[] };
  return body.voices.map((v) => ({
    id: v.voice_id,
    nome: v.name,
    descricao: [v.labels?.gender === "male" ? "masculina" : v.labels?.gender === "female" ? "feminina" : v.labels?.gender, v.labels?.accent, v.labels?.description ?? v.labels?.descriptive, v.labels?.use_case].filter(Boolean).join(" · "),
    preview: v.preview_url ?? null,
  }));
}


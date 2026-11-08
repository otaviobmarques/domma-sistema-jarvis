import { config } from "./config.js";

export function nowInTz(d = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
    label: `${get("weekday")}, ${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`,
  };
}

/** true se agora estiver dentro do horário de silêncio (ex.: 22:00–07:00) */
export function inQuietHours(inicio: string | null, fim: string | null, d = new Date()): boolean {
  if (!inicio || !fim) return false;
  const t = nowInTz(d).time;
  const a = inicio.slice(0, 5);
  const b = fim.slice(0, 5);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

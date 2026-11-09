import { cloudConfigurado, enviarCloud } from "./whatsappCloud.js";
import { sendWhatsApp, whatsappStatus } from "./whatsapp.js";

/**
 * Escolhe por onde sai o WhatsApp de cada empresa:
 * - API oficial (número próprio do cliente), se conectada;
 * - senão, o número compartilhado da plataforma (QR Code), se estiver conectado.
 */
export async function canalWhatsApp(tenantId: string): Promise<"oficial" | "compartilhado" | null> {
  if (await cloudConfigurado(tenantId)) return "oficial";
  return whatsappStatus().conectado ? "compartilhado" : null;
}

export async function whatsappDisponivel(tenantId: string): Promise<true | string> {
  return (await canalWhatsApp(tenantId)) ? true : "WhatsApp não conectado (conecte o número oficial em Integrações)";
}

export async function enviarWhatsApp(tenantId: string, numero: string, texto: string) {
  const canal = await canalWhatsApp(tenantId);
  if (canal === "oficial") return enviarCloud(tenantId, numero, texto);
  if (canal === "compartilhado") return sendWhatsApp(numero, texto);
  throw new Error("WhatsApp não conectado para esta empresa");
}

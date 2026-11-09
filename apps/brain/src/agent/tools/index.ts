import type { ToolDef } from "../types.js";
import * as ads from "./ads.js";
import * as android from "./android.js";
import * as comms from "./comms.js";
import * as data from "./data.js";
import * as google from "./google.js";
import * as memory from "./memory.js";
import * as pc from "./pc.js";
import * as routines from "./routines.js";
import * as sub from "./subagentes.js";

/** Ordem estável (importante para o cache de prompt). */
export const ALL_TOOLS: ToolDef[] = [
  memory.memoriaBuscar,
  memory.memoriaSalvar,
  memory.memoriaEsquecer,
  sub.subagentes,
  google.gmailBuscar,
  google.gmailContar,
  google.gmailLer,
  google.gmailRascunho,
  google.gmailEnviar,
  google.agendaListar,
  google.agendaHorarioLivre,
  google.agendaCriar,
  google.agendaCriarComConvidados,
  google.agendaMover,
  google.agendaCancelar,
  google.driveBuscar,
  ads.metaAdsContas,
  ads.metaAdsDesempenho,
  ads.metaAdsStatus,
  ads.metaAdsOrcamento,
  ads.googleAdsContas,
  ads.googleAdsDesempenho,
  data.dadosFontes,
  data.dadosEsquema,
  data.dadosConsultar,
  comms.whatsappEnviar,
  comms.contatosBuscar,
  routines.rotinaCriar,
  routines.rotinaListar,
  routines.rotinaAlterar,
  pc.pcAbrir,
  pc.pcArquivos,
  pc.pcApagar,
  pc.pcComando,
  pc.pcJanelas,
  pc.pcPrint,
  pc.pcCamera,
  pc.pcMouse,
  pc.pcTeclado,
  android.androidTela,
  android.androidPrint,
  android.androidTocar,
  android.androidDigitar,
  android.androidRolar,
  android.androidNavegar,
  android.androidAbrir,
  android.androidNotificacoes,
  android.androidAlarme,
  android.androidTimer,
  android.androidLigar,
] as ToolDef[];

export const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

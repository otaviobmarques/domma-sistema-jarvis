import { asaasConfigurado, criarAssinatura } from "./asaas.js";
import { audit, db } from "./db.js";
import { log } from "./log.js";
import { configPlataforma } from "./plataforma.js";

/** Cadastro público de um novo cliente do Tavinho: empresa + responsável (dono) + login + teste grátis. */

export interface DadosCadastro {
  empresa: string;
  documento: string;
  responsavel: string;
  email: string;
  whatsapp: string;
  login: string;
  senha: string;
}

export function soDigitos(s: string) {
  return s.replace(/\D/g, "");
}

export function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

// limite simples contra abuso: por IP e no total
const tentativas = new Map<string, number[]>();
function permitido(ip: string) {
  const agora = Date.now();
  const lista = (tentativas.get(ip) ?? []).filter((t) => agora - t < 3600_000);
  const total = [...tentativas.values()].flat().filter((t) => agora - t < 86_400_000).length;
  if (lista.length >= 5 || total >= 50) return false;
  lista.push(agora);
  tentativas.set(ip, lista);
  return true;
}

export class ErroCadastro extends Error {}

export async function cadastrarCliente(d: DadosCadastro, ip: string) {
  if (!permitido(ip)) throw new ErroCadastro("Muitas tentativas de cadastro. Tente de novo mais tarde.");
  const doc = soDigitos(d.documento);
  if (!(cpfValido(doc) || cnpjValido(doc))) throw new ErroCadastro("CPF ou CNPJ inválido.");
  const whatsapp = soDigitos(d.whatsapp).replace(/^(?!55)(\d{10,11})$/, "55$1");
  if (!/^55\d{10,11}$/.test(whatsapp)) throw new ErroCadastro("WhatsApp inválido. Use DDD + número, ex.: (31) 99999-8888.");
  const email = d.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroCadastro("E-mail inválido.");
  const login = d.login.trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,80}$/.test(login)) throw new ErroCadastro("Login: use letras, números e ponto (ou o seu e-mail).");
  if (d.senha.length < 8 || !/[a-zA-Z]/.test(d.senha) || !/\d/.test(d.senha)) throw new ErroCadastro("Senha: pelo menos 8 caracteres, com letras e números.");
  const empresa = d.empresa.trim().slice(0, 120);
  const responsavel = d.responsavel.trim().slice(0, 120);
  if (empresa.length < 2 || responsavel.length < 2) throw new ErroCadastro("Preencha o nome da empresa e do responsável.");
  const emailLogin = login.includes("@") ? login : `${login}@jarvis.local`;

  const sql = db();
  const { dias_teste } = await configPlataforma();
  const r = await sql.begin(async (tx) => {
    const [dup] = await tx<{ id: string }[]>`select id from users where whatsapp = ${whatsapp} or (${whatsapp.length === 13} and whatsapp = ${whatsapp.slice(0, 4) + whatsapp.slice(5)})`;
    if (dup) throw new ErroCadastro("Este WhatsApp já está cadastrado no Tavinho.");
    const [docDup] = await tx<{ id: string }[]>`select id from tenants where documento = ${doc} and status <> 'cancelado'`;
    if (docDup) throw new ErroCadastro("Já existe uma conta com este CPF/CNPJ. Fale com o suporte da Domma.");
    const [t] = await tx<{ id: string; teste_ate: Date }[]>`
      insert into tenants (nome, plano, status, teste_ate, documento, email_cobranca, telefone)
      values (${empresa}, 'por_usuario', 'teste', now() + make_interval(days => ${dias_teste}), ${doc}, ${email}, ${whatsapp})
      returning id, teste_ate`;
    const [c] = await tx<{ id: string }[]>`insert into companies (tenant_id, nome) values (${t!.id}, ${empresa}) returning id`;
    const [u] = await tx<{ id: string }[]>`
      insert into users (tenant_id, nome, perfil, whatsapp, email, autonomia)
      values (${t!.id}, ${responsavel}, 'dono', ${whatsapp}, ${email}, 2) returning id`;
    await tx`insert into user_companies (user_id, company_id) values (${u!.id}, ${c!.id})`;
    const [acesso] = await tx<{ r: string }[]>`select painel_definir_acesso(${u!.id}, ${t!.id}, ${emailLogin}, ${d.senha}, false) as r`;
    if (acesso!.r === "login_em_uso") throw new ErroCadastro("Esse login já existe. Escolha outro.");
    if (acesso!.r !== "criado") throw new ErroCadastro("Não consegui criar o login. Tente de novo.");
    return { tenantId: t!.id, userId: u!.id, testeAte: t!.teste_ate };
  });
  await audit(r.userId, "cadastro.cliente", r.tenantId, null, { empresa, dias_teste });
  log.info({ tenant: r.tenantId }, "novo cliente cadastrado");

  // A assinatura no Asaas já nasce com a 1ª fatura no fim do teste (o cliente recebe o link por e-mail).
  if (await asaasConfigurado()) {
    await criarAssinatura(r.tenantId).catch((err) => log.error({ err, tenant: r.tenantId }, "não criou a assinatura no Asaas"));
  }
  return { ...r, login };
}

# Jarvis — assistente de IA da Domma Tecnologia

Um cérebro na nuvem com memória única e várias "pontas": WhatsApp, painel web e, nas próximas fases, app de PC (voz) e app Android. Arquitetura descrita no documento *Projeto Jarvis v1.0*.

> "Jarvis" é nome provisório de trabalho (marca da Marvel/Disney). O nome comercial fica para a Fase 4.

## O que está pronto (Fase 1 + painel)

| Item do backlog (seção 20) | Onde |
|---|---|
| 1. Orquestrador na nuvem, Supabase e autenticação | `apps/brain`, `supabase/migrations`, login no painel (Supabase Auth) |
| 2. Gateway WhatsApp (texto e áudio) | `apps/brain/src/channels` (Baileys/QR — modo testes) |
| 3. Usuários, números autorizados e PIN | painel → Usuários; números desconhecidos são ignorados e registrados |
| 4. Memória v1 (gravar, buscar, painel) | busca por texto completo + trigram + recência, escopos pessoal/empresa/equipe, extração automática, diário |
| 5. Gmail e Agenda | `tools/google.ts` (+ Drive leitura) |
| 6. Ads (Google + Meta) | `tools/ads.ts` (leitura; pausar/orçamento com PIN) |
| 7. CRM e Domma Chat | fontes de dados somente leitura (`tools/data.ts`), cadastradas no painel |
| 8. Confirmações com botão e PIN | `agent/approvals.ts` — a ação aprovada é executada exatamente como mostrada |
| 9. Rotinas (cron) | `scheduler.ts` + painel → Skills e rotinas |
| 10. Histórico, auditoria e custo por tarefa | `tasks`, `task_steps`, `audit_log`; painel → Tarefas, Custos, Auditoria |
| 11. Botão de pânico `/parar` | WhatsApp, painel e API; interrompe na hora e cancela pendências |

Também: roteador de modelos (Claude Haiku 5.5 para o simples, Claude Opus 5.5 para o complexo), níveis de autonomia 1–4, horário de silêncio, limite de gasto mensal, proteção contra comandos escondidos em e-mails/sites, fila para PC/Android (`task_queue`) pronta para as Fases 2 e 3.

## Estrutura

```
apps/brain    serviço Node (Fastify) — WhatsApp, orquestrador Claude, ferramentas, rotinas, API do painel
apps/panel    painel Next.js 16 — login, chat, aprovações, tarefas, memória, rotinas, usuários, integrações, custos, auditoria
supabase/     migração do banco (18 tabelas do documento + sessão WhatsApp + tentativas bloqueadas)
```

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha
npm run dev --workspace @jarvis/brain
npm run dev --workspace @jarvis/panel
```

Testes ponta a ponta (Postgres real + API do Claude simulada):

```bash
TEST_DATABASE_URL=postgres://... npm test --workspace @jarvis/brain
```

## Deploy

Dois serviços no Railway a partir deste repositório, cada um com seu Dockerfile (`RAILWAY_DOCKERFILE_PATH=apps/brain/Dockerfile` e `apps/panel/Dockerfile`). O painel responde em `jarvis.dommasistemas.com.br` e repassa `/oauth/*` ao cérebro pela rede privada do Railway.

## Comandos no WhatsApp

`/parar` · `/retomar` · `/status` · `/rotinas` · `/esquece <assunto>` · `/ajuda`

## Próximas fases

- **Fase 2 — App PC (Tauri)**: palavra de ativação, Whisper local, voz, ações locais, navegador e controle de tela. Consome `task_queue` e `devices`.
- **Fase 3 — Android (Kotlin)**: Serviço de Acessibilidade, notificações, ações do sistema.
- **Fase 4 — Produto**: skills que aprendem, sub-agentes em paralelo, multi-tenant comercial, API Oficial do WhatsApp, nome e marca.

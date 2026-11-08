# Jarvis para PC (Windows) — Fase 2

App de bandeja feito com [Tauri 2](https://tauri.app) (Rust + interface web), instalador de ~10 MB.

## O que faz

- **Ctrl+Espaço** abre/fecha a caixa de comando; **Ctrl+Shift+Espaço** começa/termina de falar.
- Inicia com o Windows, fica na bandeja; fechar a janela só esconde.
- Responde falando (voz do Windows), com o orbe animado: azul ouvindo, violeta pensando, verde falando, vermelho erro.
- Conexão permanente com o cérebro (long-polling em `/device/poll`), então o Jarvis pode agir no PC mesmo quando o pedido chega pelo WhatsApp:
  - `abrir` programas, sites e arquivos
  - `arquivos`: listar, ler, criar pasta, mover, copiar, escrever (`apagar` vai para a Lixeira e exige PIN)
  - `comando` PowerShell (sempre com confirmação)
  - `janelas` abertas
  - `print` da tela + `mouse` e `teclado`: controle de tela (último recurso)
- Botão de pânico na janela e na bandeja: solta teclado/mouse, cancela tudo e pausa o Jarvis.
- Modo privacidade: microfone desligado.
- O token do dispositivo fica no Gerenciador de Credenciais do Windows.

## Pareamento

Painel → **Dispositivos** → **Gerar código de pareamento** → digite o código no app.

## Desenvolvimento

```bash
npm install
cd apps/pc && npx tauri dev
```

O instalador é gerado pelo GitHub Actions (`.github/workflows/pc-windows.yml`) a cada mudança em `apps/pc` e publicado em Releases.

## Próximo (Fase 2.2)

- Palavra de ativação "Jarvis…" sem clicar (detector local).
- Transcrição local (whisper.cpp) e voz local (Piper).
- Modo Jarvis em tela cheia no segundo monitor e área de trabalho virtual.

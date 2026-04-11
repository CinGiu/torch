# AI Dev Pipeline

Pipeline di sviluppo autonoma che implementa GitHub issue usando agenti AI (Claude Code CLI / opencode).

## Stack

- **Go** — webhook server + worker pool (Asynq)
- **Redis** — task queue
- **React** — UI di configurazione
- **Claude Code CLI / opencode** — agenti AI

## Quick start

```bash
docker compose up -d --build
```

Apri **http://localhost:8080** e configura:

1. **Agents** — scegli `claude` o `opencode` per ogni agente, inserisci le API key, personalizza i system prompt
2. **GitHub** — inserisci il token e il webhook secret, premi **save config**
3. **Export** — scarica il `docker-compose.yml` aggiornato se necessario

## Configurazione GitHub

### 1. Fine-grained token

GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token

Permessi richiesti sul repo target:

| Permesso       | Livello       |
|----------------|---------------|
| Contents       | Read & write  |
| Pull requests  | Read & write  |
| Issues         | Read & write  |
| Metadata       | Read          |

### 2. Webhook

repo → Settings → Webhooks → Add webhook

| Campo        | Valore                                     |
|--------------|--------------------------------------------|
| Payload URL  | `https://your-server:8080/webhook/github`  |
| Content type | `application/json`                         |
| Secret       | stessa stringa inserita nella UI           |
| Events       | `Issues`                                   |

## Trigger

Aggiungi la label `ai-implement` (o quella configurata nella UI) a una issue — la pipeline parte automaticamente.

## Flusso

```
Issue labeled  →  [Developer]  →  [Tester]  →  [Reviewer]
                       ↑               |               |
                       └───── fix ─────┘               |
                       ↑                               |
                       └──────────── fix ──────────────┘
                                      |
                                   git push → PR aperta
```

Ogni step di fallimento rimanda al developer con il feedback dettagliato.
Il numero massimo di round di fix è configurabile per agente dalla UI.

## Agenti

| Agente    | Ruolo                                        |
|-----------|----------------------------------------------|
| Developer | Implementa la feature, scrive i test         |
| Tester    | Esegue `flutter test`, verifica la copertura |
| Reviewer  | Code review su qualità e architettura        |

## Sviluppo locale

```bash
# Backend
cd pipeline
go run ./cmd/server

# Frontend (in un altro terminale)
cd frontend
npm install
npm run dev   # http://localhost:5173 con proxy verso :8080
```

## Note

- **Flutter** è installato nell'immagine Docker — la build è ~2-3 GB
- **opencode**: decommenta la riga `npm install -g opencode-ai` nel Dockerfile con il nome npm corretto
- La configurazione è salvata in un volume Docker persistente (`pipeline_data:/data/config.json`)
- I workspace temporanei sono in `/workspaces/issue-{N}` e vengono eliminati a fine pipeline

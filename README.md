# Torch

A self-hosted orchestrator that autonomously implements GitHub issues using AI coding agents. Designed for mobile development teams (Flutter, React Native) but works with any stack.

You connect it to a GitHub repository, and when an issue is labeled or manually triggered from the UI, the system clones the repo, runs a three-agent pipeline (Developer → Tester → Reviewer), and opens a pull request with the implementation — without any human intervention.

---

## How it works

```
GitHub Issue
     │
     ▼
┌─────────────┐
│  Webhook /  │  label trigger or manual UI trigger
│  UI Trigger │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│                   Pipeline (per issue)              │
│                                                     │
│  ┌───────────┐    ┌──────────┐    ┌──────────────┐  │
│  │ Developer │ →  │  Tester  │ →  │   Reviewer   │  │
│  │           │    │          │    │              │  │
│  │ Implements│    │ Writes & │    │ Code review  │  │
│  │ the issue │    │ runs     │    │ architecture │  │
│  │           │    │ tests    │    │ security     │  │
│  └───────────┘    └──────────┘    └──────────────┘  │
│       ↑                │                │           │
│       └────── fix ─────┴────── fix ─────┘           │
│              (up to N rounds)                       │
└─────────────────────────────────────────────────────┘
       │
       ▼
  Pull Request opened on GitHub
```

Each agent is an independent AI CLI process (`claude` or `opencode`) running in an isolated workspace. Agents communicate only through the filesystem and git — the orchestrator coordinates them sequentially and feeds failure feedback back to the Developer for fix rounds.

---

## Features

- **Multi-agent pipeline** — Developer implements, Tester writes and runs tests, Reviewer checks code quality
- **Automatic fix loops** — if Tester or Reviewer fails, the Developer gets the feedback and retries
- **GitHub integration** — webhook trigger, issue labels (`ai: in-progress`, `ai: testing`, `ai: done`, …), automatic PR
- **UI monitor** — web dashboard to start/stop the pipeline, browse issues, trigger runs manually, and watch live agent output
- **Any AI CLI** — works with Claude Code (`claude`) and opencode; configure per-agent
- **Any stack** — configurable `test_command` and `lint_command`; Flutter, Node.js, Python, Go, etc.
- **Concurrent runs** — configurable worker concurrency; each issue runs in its own isolated workspace
- **Retry + timeout** — each agent retries up to 3 times with a configurable timeout before failing
- **Self-hosted** — everything runs in Docker; no external services except Redis (bundled) and the AI API

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose                                             │
│                                                             │
│  ┌─────────────────────────────────────────┐  ┌─────────┐  │
│  │  pipeline container                     │  │  Redis  │  │
│  │                                         │  │         │  │
│  │  ┌──────────┐  ┌────────┐  ┌────────┐   │  │  task   │  │
│  │  │ Go HTTP  │  │ Asynq  │  │ Agent  │   │  │  queue  │  │
│  │  │ server   │  │ worker │  │ runner │   │  │         │  │
│  │  │          │  │ pool   │  │        │   │  └─────────┘  │
│  │  │ React UI │  │        │  │ claude │   │               │
│  │  │ embedded │  │        │  │   or   │   │               │
│  │  └──────────┘  └────────┘  │opencode│   │               │
│  │                            └────────┘   │               │
│  └─────────────────────────────────────────┘               │
│                          │                                  │
│                    ./workspaces/   (bind mount)             │
│                    ./data/         (bind mount)             │
└─────────────────────────────────────────────────────────────┘
```

- **Go HTTP server** — serves the React UI and REST API, handles GitHub webhooks
- **Asynq worker pool** — processes issues concurrently from the Redis queue
- **Agent runner** — spawns the AI CLI as a subprocess, streams output, enforces timeouts, retries on failure
- **React UI** — setup wizard + live dashboard; embedded in the Go binary via `go:embed`

---

## Requirements

- **Server**: Docker + Docker Compose (any Linux host, x64 or ARM64)
- **AI CLI**: Claude Code or opencode — installed inside the Docker image automatically
- **GitHub**: a fine-grained personal access token with repository permissions
- **API key**: Anthropic API key (for Claude) or your provider's key (for opencode)

The server host needs no SDKs installed. Flutter and all build tools run inside the Docker image.

---

## Getting started

### 1. Clone and start

```bash
git clone https://github.com/your-org/torch
cd torch
docker compose up --build
```

The first build downloads Flutter and the AI CLIs — expect a few minutes.

### 2. Open the UI

```
http://localhost:8080
```

The setup wizard guides you through:
1. **Agents** — choose `claude` or `opencode` for each role; enter API keys
2. **GitHub** — paste your fine-grained token and webhook secret
3. **Pipeline** — set `test_command` and `lint_command` for your stack
4. **Launch** — activate the pipeline

### 3. Connect GitHub

In your repository → Settings → Webhooks → Add webhook:
- Payload URL: `https://your-server:8080/webhook/github`
- Content type: `application/json`
- Events: **Issues**
- Secret: the webhook secret you set in step 2

### 4. Trigger a run

**Automatic**: add the configured trigger label (default: `ai-implement`) to any issue.

**Manual**: go to the Issues tab in the dashboard, pick a repo, and click **▶ Run** next to any issue.

---

## Configuration

All configuration is managed through the UI and persisted in `./data/config.json`.

### GitHub token permissions

| Permission | Level | Purpose |
|---|---|---|
| Contents | Read & write | clone + push branch |
| Pull requests | Read & write | open the PR |
| Issues | Read & write | labels + comments |
| Metadata | Read | required |

### Stack examples

| Stack | Test command | Lint command |
|---|---|---|
| Flutter | `flutter test` | `flutter analyze` |
| Node.js | `npm test` | `npm run lint` |
| Python | `pytest --tb=short` | `ruff check .` |
| Go | `go test ./...` | `go vet ./...` |

### opencode provider (custom models)

If you use opencode with a custom LLM provider, paste the full `opencode.json` in **Settings → Pipeline → Opencode Config**. It gets injected into every workspace before agents run, alongside `permission: {"*": "allow"}` so agents never pause for confirmation.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_ADDR` | `redis:6379` | Redis address |
| `CONFIG_PATH` | `/data/config.json` | Config file path |
| `CONCURRENCY` | `4` | Max parallel issues |
| `LOG_LEVEL` | `info` | `info` or `debug` |
| `KEEP_WORKSPACE` | `false` | Keep workspace after run (debug only) |

---

## Production deployment

```bash
# Copy to server
scp docker-compose.yml user@server:~/torch/
ssh user@server "cd ~/torch && docker compose up -d"
```

For public webhook access, put a reverse proxy (nginx, Caddy) or Cloudflare Tunnel in front of port 8080.

Remove `KEEP_WORKSPACE=true` and `LOG_LEVEL=debug` from `docker-compose.yml` before deploying.

---

## Project structure

```
.
├── cmd/server/          # Go entrypoint
├── internal/
│   ├── agent/           # AI CLI runner + prompt builders
│   ├── api/             # REST API handlers
│   ├── config/          # Config manager
│   ├── gitclient/       # Git operations
│   ├── githubclient/    # GitHub API (issues, PRs, labels)
│   ├── livelog/         # In-memory live log store
│   ├── pipeline/        # Multi-agent orchestrator
│   ├── types/           # Shared types
│   ├── webhook/         # GitHub webhook handler
│   └── worker/          # Asynq task processor
├── frontend/            # React + Vite UI
├── web/                 # go:embed target for built frontend
├── Dockerfile
└── docker-compose.yml
```

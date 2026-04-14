<div align="center">
  <img src="frontend/public/logo.png" alt="Torch" width="220" />
  <h1>Torch</h1>
  <p>Self-hosted AI coding agent orchestrator.<br>
  Turns GitHub issues into pull requests — autonomously.</p>
</div>

---

You connect Torch to a GitHub repository. When an issue is labeled or triggered from the dashboard, the system clones the repo, runs a three-agent pipeline (Developer → Tester → Reviewer), and opens a pull request — without human intervention. Between runs you can groom issues from your phone via the built-in web terminal.

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

- **Multi-agent pipeline** — Developer implements, Tester writes tests, Reviewer checks quality
- **Automatic fix loops** — if Tester or Reviewer fail, the Developer gets feedback and retries (configurable rounds)
- **GitHub integration** — webhook trigger, issue labels (`ai: in-progress`, `ai: testing`, `ai: done`, …), automatic PR
- **Web dashboard** — monitor runs, browse issues, trigger manually, watch live agent output
- **Web terminal** — full PTY in the browser; clone any repo and run `claude` from your phone to groom issues on the go
- **Any AI CLI** — works with Claude Code (`claude`) and opencode; configure per-agent
- **Any stack** — configurable `test_command` and `lint_command`; Flutter, Node.js, Python, Go, etc.
- **Concurrent runs** — configurable worker concurrency; each issue in its own isolated workspace
- **Self-hosted** — everything runs in Docker; no external services except Redis (bundled) and the AI API

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose                                             │
│                                                             │
│  ┌─────────────────────────────────────────┐  ┌─────────┐  │
│  │  torch container                        │  │  Redis  │  │
│  │                                         │  │         │  │
│  │  ┌──────────┐  ┌────────┐  ┌────────┐   │  │  task   │  │
│  │  │ Go HTTP  │  │ Asynq  │  │ Agent  │   │  │  queue  │  │
│  │  │ server   │  │ worker │  │ runner │   │  │         │  │
│  │  │          │  │ pool   │  │        │   │  └─────────┘  │
│  │  │ React UI │  │        │  │ claude │   │               │
│  │  │ embedded │  │        │  │   or   │   │               │
│  │  │          │  │        │  │opencode│   │               │
│  │  └──────────┘  └────────┘  └────────┘   │               │
│  │  ┌─────────────────────────────────┐     │               │
│  │  │  WebSocket PTY terminal         │     │               │
│  │  │  (bash + claude, mobile-ready)  │     │               │
│  │  └─────────────────────────────────┘     │               │
│  └─────────────────────────────────────────┘               │
│                          │                                  │
│                    ./workspaces/   (bind mount)             │
│                    ./data/         (SQLite + sessions)      │
└─────────────────────────────────────────────────────────────┘
```

- **Go HTTP server** — serves the React UI, REST API, GitHub webhooks, and WebSocket terminal
- **Asynq worker pool** — processes issues concurrently from the Redis queue
- **Agent runner** — spawns the AI CLI as a subprocess, streams output, enforces timeouts, retries on failure
- **WebSocket PTY** — real bash session in the browser; clones any repo on open; includes a key toolbar (Tab, arrows, Ctrl+C) optimised for mobile
- **React UI** — setup wizard + live dashboard; embedded in the Go binary via `go:embed`
- **SQLite** — persists per-user config and login sessions; no external database needed

---

## Requirements

- **Server**: Docker + Docker Compose (Linux, x64 or ARM64)
- **Auth**: a [Cubbit](https://cubbit.io) account (used for login)
- **AI CLI**: Claude Code or opencode — installed inside the Docker image automatically
- **GitHub**: a fine-grained personal access token with repository permissions
- **API key**: Anthropic API key (for Claude) or your provider's key (for opencode)

---

## Getting started

### 1. Clone and start

```bash
# Install Git LFS (once per machine)
# Debian/Ubuntu:  apt-get install git-lfs
# RHEL/Fedora:    dnf install git-lfs
# macOS:          brew install git-lfs
git lfs install

git clone git@github.com:CinGiu/torch.git
cd torch
docker compose up --build -d
```

The first build downloads Flutter and the AI CLIs — expect a few minutes.

### 2. Open the UI

```
http://localhost:8080
```

Log in with your Cubbit account. The setup wizard guides you through:

1. **Agents** — choose `claude` or `opencode` for each role; enter API keys
2. **GitHub** — paste your fine-grained token and webhook secret
3. **Pipeline** — set `test_command` and `lint_command` for your stack
4. **Launch** — activate the pipeline

### 3. Connect GitHub

In your repository → Settings → Webhooks → Add webhook:
- Payload URL: `https://your-server:8080/webhook/github/<your-account-id>`
- Content type: `application/json`
- Events: **Issues**
- Secret: the webhook secret you set in step 2

### 4. Trigger a run

**Automatic**: add the configured trigger label (default: `ai-implement`) to any issue.

**Manual**: go to the Issues tab in the dashboard, pick a repo, and click **▶ Run**.

### 5. Groom from mobile

Open the **Terminal** tab, pick a repo — Torch clones it and drops you into a bash session with `claude` available. Use `create_issue` to push a new issue directly from the terminal.

---

## Configuration

### GitHub token permissions

| Permission | Level | Purpose |
|---|---|---|
| Contents | Read & write | clone + push branch |
| Pull requests | Read & write | open the PR |
| Issues | Read & write | labels + comments + create |
| Metadata | Read | required + repo listing |

For fine-grained PATs, set scope to **All repositories** (or select specific repos).

### Stack examples

| Stack | Test command | Lint command |
|---|---|---|
| Flutter | `flutter test` | `flutter analyze` |
| Node.js | `npm test` | `npm run lint` |
| Python | `pytest --tb=short` | `ruff check .` |
| Go | `go test ./...` | `go vet ./...` |

### opencode provider (custom models)

Paste the full `opencode.json` in **Settings → Pipeline → Opencode Config**. It gets injected into every workspace before agents run.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_ADDR` | `redis:6379` | Redis address |
| `DB_PATH` | `/data/torch.db` | SQLite database path |
| `WORKSPACES_DIR` | `/workspaces` | Agent workspace root |
| `CONCURRENCY` | `4` | Max parallel issues |
| `LOG_LEVEL` | `info` | `info` or `debug` |

---

## Production deployment

```bash
scp docker-compose.yml user@server:~/torch/
ssh user@server "cd ~/torch && docker compose up -d"
```

For HTTPS, put a reverse proxy in front of port 9094.

---

## Project structure

```
.
├── cmd/server/          # Go entrypoint + HTTP/WebSocket server
├── internal/
│   ├── agent/           # AI CLI runner + prompt builders
│   ├── api/             # REST API handlers + session exchange
│   ├── config/          # Config defaults
│   ├── gitclient/       # Git clone / push
│   ├── githubclient/    # GitHub API (issues, PRs, labels, repos)
│   ├── livelog/         # In-memory live log store
│   ├── proxy/           # Cubbit reverse proxy + auth
│   ├── store/           # SQLite (user configs + sessions)
│   ├── webhook/         # GitHub webhook handler
│   ├── worker/          # Asynq task dispatcher + processor
│   └── ws/              # WebSocket PTY terminal handler
├── frontend/            # React + Vite UI
├── web/                 # go:embed target for built frontend
├── Dockerfile
└── docker-compose.yml
```

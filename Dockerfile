# ─── Stage 1: Build frontend ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# ─── Stage 2: Build Go binary ────────────────────────────────────────────────
FROM golang:1.25-alpine AS go-builder

WORKDIR /app

COPY go.mod ./
COPY go.sum* ./

COPY cmd/     cmd/
COPY internal/ internal/
COPY web/     web/

COPY --from=frontend-builder /app/frontend/dist/ web/dist/

RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w -X main.buildTime=$(date -u +%Y%m%dT%H%M%SZ)" \
      -o /torch ./cmd/server

# ─── Stage 3: Final runtime image ────────────────────────────────────────────
# node:20-slim is Debian-based (glibc) — required for opencode's Linux binary
FROM node:20-slim

# Base tools available to all agents regardless of project type.
# SDK-specific runtimes (Flutter, Python, Go, …) are mounted from the host
# via volumes in docker-compose.yml and exposed to agents via PATH in Settings.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    git-lfs \
    curl \
    bash \
    unzip \
    xz-utils \
    ca-certificates \
    ncurses-base \
    ncurses-term \
    && git lfs install \
    && rm -rf /var/lib/apt/lists/*

ENV TERM=xterm-256color

# ── Install Claude Code CLI ──────────────────────────────────────────────────
RUN curl -fsSL https://claude.ai/install.sh | bash

# ── Install opencode CLI (Linux binary via official installer) ────────────────
RUN curl -fsSL https://opencode.ai/install | bash && \
    ln -s /root/.opencode/bin/opencode /usr/local/bin/opencode

# ── Install OhMyOpenCode plugin (pre-configured, user-enabled) ───────────────
RUN npm install -g oh-my-opencode

# ── Copy torch binary ────────────────────────────────────────────────────────
COPY --from=go-builder /torch /usr/local/bin/torch

RUN mkdir -p /workspaces /data

EXPOSE 8080

CMD ["torch"]

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
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /torch ./cmd/server

# ─── Stage 3: Final runtime image ────────────────────────────────────────────
# node:20-slim is Debian-based (glibc) — required for opencode's Linux binary
FROM node:20-slim

# Runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    git-lfs \
    curl \
    bash \
    unzip \
    xz-utils \
    ca-certificates \
    libglu1-mesa \
    && git lfs install \
    && rm -rf /var/lib/apt/lists/*

# ── Install Flutter via git (works on both x64 and arm64) ────────────────────
ARG FLUTTER_VERSION=3.29.3
RUN git clone --depth 1 --branch ${FLUTTER_VERSION} \
        https://github.com/flutter/flutter.git /opt/flutter && \
    /opt/flutter/bin/flutter config --no-analytics && \
    /opt/flutter/bin/flutter precache --no-android --no-ios --no-web

ENV PATH="/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:$PATH"
ENV FLUTTER_ROOT="/opt/flutter"
ENV PUB_CACHE="/root/.pub-cache"

# ── Install Claude Code CLI ──────────────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code

# ── Install opencode CLI (Linux binary via official installer) ────────────────
RUN curl -fsSL https://opencode.ai/install | bash && \
    ln -s /root/.opencode/bin/opencode /usr/local/bin/opencode

# ── Copy torch binary ────────────────────────────────────────────────────────
COPY --from=go-builder /torch /usr/local/bin/torch

RUN mkdir -p /workspaces /data

EXPOSE 8080

CMD ["torch"]

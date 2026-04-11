# ─── Stage 1: Build frontend ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# ─── Stage 2: Build Go binary ────────────────────────────────────────────────
FROM golang:1.22-alpine AS go-builder

WORKDIR /app

# Copy go mod files first for layer caching
COPY go.mod ./
COPY go.sum* ./

# Copy all Go source
COPY cmd/     cmd/
COPY internal/ internal/
COPY web/     web/

# Copy built frontend into the embed location
COPY --from=frontend-builder /app/frontend/dist/ web/dist/

# Download deps and build
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /pipeline ./cmd/server

# ─── Stage 3: Final runtime image ────────────────────────────────────────────
FROM node:20-alpine

# Runtime dependencies
RUN apk add --no-cache \
    git \
    curl \
    bash \
    unzip \
    xz

# ── Install Flutter ──────────────────────────────────────────────────────────
ENV FLUTTER_VERSION=3.22.2
ENV FLUTTER_HOME=/opt/flutter
ENV PATH="$FLUTTER_HOME/bin:$PATH"

RUN git clone https://github.com/flutter/flutter.git \
      --depth 1 --branch stable $FLUTTER_HOME && \
    flutter config --no-analytics && \
    flutter precache --no-android --no-ios --no-web && \
    flutter doctor || true

# ── Install Claude Code CLI ──────────────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code

# ── Install opencode CLI ─────────────────────────────────────────────────────
# Uncomment and adjust if opencode is available on npm:
# RUN npm install -g opencode-ai

# ── Copy pipeline binary ─────────────────────────────────────────────────────
COPY --from=go-builder /pipeline /usr/local/bin/pipeline

# Workspaces directory
RUN mkdir -p /workspaces /data

EXPOSE 8080

CMD ["pipeline"]

package main

import (
	"context"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"torch/internal/api"
	"torch/internal/config"
	"torch/internal/webhook"
	"torch/internal/worker"
	"torch/web"

	"github.com/hibiken/asynq"
)

func main() {
	logLevel := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		logLevel = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})))

	redisAddr := getEnv("REDIS_ADDR", "redis:6379")
	configPath := getEnv("CONFIG_PATH", "/data/config.json")
	concurrency := getEnvInt("CONCURRENCY", 4)

	// ── Config ────────────────────────────────────
	cfgMgr, err := config.NewManager(configPath)
	if err != nil {
		slog.Error("cannot load config", "err", err)
		os.Exit(1)
	}
	slog.Info("config loaded", "path", configPath)

	// ── Check CLIs ────────────────────────────────
	checkCLIs(cfgMgr.Get())

	// ── Standard lib router ────────────────────────────────
	mux := http.NewServeMux()

	dispatcher := worker.NewDispatcher(redisAddr)

	// API routes
	apiHandler := api.NewHandler(cfgMgr, redisAddr, dispatcher)
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			apiHandler.GetConfig(w, r)
		case http.MethodPost:
			apiHandler.SaveConfig(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GetStatus(w, r)
	})
	mux.HandleFunc("/api/pipeline/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.StartPipeline(w, r)
	})
	mux.HandleFunc("/api/pipeline/stop", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.StopPipeline(w, r)
	})
	mux.HandleFunc("/api/issues", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.ListIssues(w, r)
	})
	mux.HandleFunc("/api/pipeline/trigger", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.TriggerIssue(w, r)
	})
	mux.HandleFunc("/api/live-log", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GetLiveLog(w, r)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Webhook
	webhookHandler := webhook.NewHandler(cfgMgr, dispatcher)
	mux.HandleFunc("/webhook/github", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		webhookHandler.Handle(w, r)
	})

	// Frontend — serve embedded dist/
	distFS, err := fs.Sub(web.FS, "dist")
	if err != nil {
		slog.Error("cannot open embedded frontend", "err", err)
		os.Exit(1)
	}

	// SPA: serve static assets directly, fall back to index.html for unknown paths
	fileServer := http.FileServer(http.FS(distFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if f, err := distFS.Open(path); err == nil {
			info, err := f.Stat()
			f.Close()
			if err == nil && !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		// Unknown path → SPA index.html
		index, err := distFS.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer index.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.Copy(w, index)
	})

	// ── Asynq worker (same process) ───────────────
	processor := worker.NewProcessor(cfgMgr)

	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: redisAddr},
		asynq.Config{Concurrency: concurrency},
	)
	mux2 := asynq.NewServeMux()
	mux2.HandleFunc(worker.TaskTypeIssue, processor.ProcessIssueTask)

	go func() {
		slog.Info("worker pool started", "concurrency", concurrency, "redis", redisAddr)
		if err := srv.Run(mux2); err != nil {
			slog.Error("worker crashed", "err", err)
			os.Exit(1)
		}
	}()

	// ── HTTP server ───────────────────────────────
	slog.Info("server listening", "addr", ":8080")
	if err := http.ListenAndServe(":8080", loggingMiddleware(mux)); err != nil {
		slog.Error("server crashed", "err", err)
		os.Exit(1)
	}
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log := slog.With("method", r.Method, "path", r.URL.Path, "remote", r.RemoteAddr)
		ww := &recordingResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(ww, r)
		if r.URL.Path != "/api/status" && r.URL.Path != "/api/live-log" {
			log.Info("request", "status", ww.statusCode, "duration_ms", time.Since(start).Milliseconds())
		}
	})
}

type recordingResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *recordingResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func checkCLIs(cfg config.Config) {
	seen := map[string]bool{}
	for role, agentCfg := range cfg.Agents {
		if seen[agentCfg.CLI] || agentCfg.CLI == "" {
			continue
		}
		seen[agentCfg.CLI] = true
		out, err := exec.Command(agentCfg.CLI, "--version").CombinedOutput()
		if err != nil {
			slog.Warn("CLI not found or not working", "role", role, "cli", agentCfg.CLI, "err", err)
		} else {
			slog.Info("CLI ready", "cli", agentCfg.CLI, "version", string(out))
		}
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

// Required for go:embed — see web/embed.go
var _ = context.Background

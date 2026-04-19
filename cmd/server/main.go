package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"torch/internal/api"
	"torch/internal/config"
	"torch/internal/proxy"
	"torch/internal/store"
	"torch/internal/webhook"
	"torch/internal/worker"
	"torch/internal/ws"
	"torch/web"

	"github.com/hibiken/asynq"
)

func main() {
	logLevel := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		logLevel = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})))

	redisAddr      := getEnv("REDIS_ADDR", "redis:6379")
	dbPath         := getEnv("DB_PATH", "/data/torch.db")
	workspacesDir  := getEnv("WORKSPACES_DIR", "/workspaces")
	concurrency    := getEnvInt("CONCURRENCY", 4)
	adminEmail     := getEnv("ADMIN_EMAIL", "")
	allowedDomain  := getEnv("ALLOWED_DOMAIN", "")

	// ── Store (SQLite, per-user configs) ──────────
	st, err := store.New(dbPath)
	if err != nil {
		slog.Error("cannot open store", "err", err)
		os.Exit(1)
	}
	slog.Info("store ready", "path", dbPath)

	// ── Check CLIs from any stored config ─────────
	checkCLIsFromStore(st)

	// ── Router ────────────────────────────────────
	mux := http.NewServeMux()

	dispatcher := worker.NewDispatcher(redisAddr)
	apiHandler := api.NewHandler(st, redisAddr, dispatcher, adminEmail, allowedDomain)

	// Session exchange — no prior auth required
	mux.HandleFunc("/api/session", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			apiHandler.ExchangeSession(w, r)
		case http.MethodDelete:
			apiHandler.DeleteSession(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// API routes (protected by authMiddleware)
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
	mux.HandleFunc("/api/repos", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.ListUserRepos(w, r)
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
	mux.HandleFunc("/api/sdks", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GetSDKs(w, r)
	})

	// Admin routes — require both auth + matching ADMIN_ACCOUNT_ID
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("/api/admin/runs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.AdminGetRuns(w, r)
	})
	adminMux.HandleFunc("/api/admin/users", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.AdminGetUsers(w, r)
	})
	adminMux.HandleFunc("/api/admin/stats", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.AdminGetStats(w, r)
	})
	mux.Handle("/api/admin/", adminMiddleware(st, adminMux))

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Webhook — no auth, uses per-user HMAC secret; account_id in path
	webhookHandler := webhook.NewHandler(st, dispatcher)
	mux.HandleFunc("/webhook/github/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		webhookHandler.Handle(w, r)
	})

	// WebSocket terminal — auth handled inside the handler via ?token= param
	mux.HandleFunc("/ws/terminal", ws.TerminalHandler(st.GetAccountBySession, st))

	// Cubbit reverse proxy (no auth — needed for the login flow itself)
	cubbitProxy := proxy.CubbitHandler()
	mux.Handle("/cubbit-proxy/iam/", cubbitProxy)
	mux.Handle("/cubbit-proxy/composer-hub/", cubbitProxy)
	mux.Handle("/cubbit-proxy/keyvault/", cubbitProxy)
	mux.HandleFunc("/cubbit-proxy/console-proxy/tenant-id", proxy.ConsoleTenantHandler)

	// Frontend — serve embedded dist/
	distFS, err := fs.Sub(web.FS, "dist")
	if err != nil {
		slog.Error("cannot open embedded frontend", "err", err)
		os.Exit(1)
	}
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
		index, err := distFS.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer index.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.Copy(w, index)
	})

	// ── Asynq worker ──────────────────────────────
	processor := worker.NewProcessor(st, workspacesDir)
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
	if err := http.ListenAndServe(":8080", corsMiddleware(loggingMiddleware(authMiddleware(st, mux)))); err != nil {
		slog.Error("server crashed", "err", err)
		os.Exit(1)
	}
}

// authMiddleware looks up the local session token (Bearer header) in the SQLite
// sessions table and injects account_id into the request context.
// /api/session itself is exempt (it's how sessions are created/deleted).
func authMiddleware(st *store.Store, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/session" {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				writeUnauthorized(w)
				return
			}
			token := strings.TrimPrefix(authHeader, "Bearer ")
			accountID, err := st.GetAccountBySession(token)
			if err != nil {
				writeUnauthorized(w)
				return
			}
			ctx := context.WithValue(r.Context(), api.ContextAccountID, accountID)
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

// adminMiddleware rejects requests whose session does not have the is_admin flag.
// Must run after authMiddleware (relies on Bearer token in Authorization header).
func adminMiddleware(st *store.Store, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		ok, err := st.IsAdminSession(token)
		if err != nil || !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"forbidden"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"unauthorized"}`))
}

// corsMiddleware adds CORS headers so the API is reachable from browser
// frontends served on a different origin (e.g. the Vite dev server or a
// custom domain). The allowed origin is read from CORS_ORIGIN (default: *).
func corsMiddleware(next http.Handler) http.Handler {
	allowed := getEnv("CORS_ORIGIN", "*")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		if allowed == "*" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			w.Header().Set("Access-Control-Allow-Origin", allowed)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
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

// Hijack forwards the hijack call to the underlying ResponseWriter so that
// WebSocket upgrades (which need to take over the raw TCP connection) work
// even when the response is wrapped by loggingMiddleware.
func (w *recordingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}

func checkCLIsFromStore(st *store.Store) {
	configs, err := st.GetAllConfigs()
	if err != nil {
		return
	}
	seen := map[string]bool{}
	for _, cfg := range configs {
		checkCLIs(cfg)
		_ = seen
	}
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

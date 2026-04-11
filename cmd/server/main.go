package main

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/exec"

	"ai-pipeline/internal/api"
	"ai-pipeline/internal/config"
	"ai-pipeline/internal/webhook"
	"ai-pipeline/internal/worker"
	"ai-pipeline/web"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
)

func main() {
	redisAddr := getEnv("REDIS_ADDR", "redis:6379")
	configPath := getEnv("CONFIG_PATH", "/data/config.json")
	concurrency := 4

	// ── Config ────────────────────────────────────
	cfgMgr, err := config.NewManager(configPath)
	if err != nil {
		slog.Error("cannot load config", "err", err)
		os.Exit(1)
	}
	slog.Info("config loaded", "path", configPath)

	// ── Check CLIs ────────────────────────────────
	checkCLIs(cfgMgr.Get())

	// ── Gin router ────────────────────────────────
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// API routes
	apiHandler := api.NewHandler(cfgMgr)
	r.GET("/api/config", apiHandler.GetConfig)
	r.POST("/api/config", apiHandler.SaveConfig)
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	// Webhook
	dispatcher := worker.NewDispatcher(redisAddr)
	webhookHandler := webhook.NewHandler(cfgMgr, dispatcher)
	r.POST("/webhook/github", webhookHandler.Handle)

	// Frontend — serve embedded dist/
	distFS, err := fs.Sub(web.FS, "dist")
	if err != nil {
		slog.Error("cannot open embedded frontend", "err", err)
		os.Exit(1)
	}
	r.NoRoute(func(c *gin.Context) {
		// SPA fallback: serve index.html for unknown paths
		fileServer := http.FileServer(http.FS(distFS))
		fileServer.ServeHTTP(c.Writer, c.Request)
	})

	// ── Asynq worker (same process) ───────────────
	processor := worker.NewProcessor(cfgMgr)

	srv := asynq.NewServer(
		asynq.RedisClientOpt{Addr: redisAddr},
		asynq.Config{Concurrency: concurrency},
	)
	mux := asynq.NewServeMux()
	mux.HandleFunc(worker.TaskTypeIssue, processor.ProcessIssueTask)

	go func() {
		slog.Info("worker pool started", "concurrency", concurrency, "redis", redisAddr)
		if err := srv.Run(mux); err != nil {
			slog.Error("worker crashed", "err", err)
			os.Exit(1)
		}
	}()

	// ── HTTP server ───────────────────────────────
	slog.Info("server listening", "addr", ":8080")
	if err := r.Run(":8080"); err != nil {
		slog.Error("server crashed", "err", err)
		os.Exit(1)
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

// Required for go:embed — see web/embed.go
var _ = context.Background

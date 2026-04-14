package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"torch/internal/store"
	"torch/internal/worker"
)

type Handler struct {
	store      *store.Store
	dispatcher *worker.Dispatcher
}

func NewHandler(st *store.Store, dispatcher *worker.Dispatcher) *Handler {
	return &Handler{store: st, dispatcher: dispatcher}
}

// Handle serves POST /webhook/github/{accountID}.
// Each user has their own webhook URL so that their per-user config
// (token, webhook secret, trigger label) is used.
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request) {
	// Extract accountID from path: /webhook/github/{accountID}
	accountID := strings.TrimPrefix(r.URL.Path, "/webhook/github/")
	if accountID == "" || strings.Contains(accountID, "/") {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "missing account id in path"})
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "cannot read body"})
		return
	}

	cfg, err := h.store.GetConfig(accountID)
	if err != nil {
		slog.Warn("webhook: cannot load config", "account", accountID, "err", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "internal error"})
		return
	}

	if !validateSignature(cfg.Github.WebhookSecret, r.Header.Get("X-Hub-Signature-256"), body) {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid signature"})
		return
	}

	if r.Header.Get("X-GitHub-Event") != "issues" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ignored"})
		return
	}

	var payload issuePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid payload"})
		return
	}

	if !cfg.Pipeline.Active {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "pipeline not active"})
		return
	}

	if payload.Action != "labeled" || payload.Label.Name != cfg.Github.TriggerLabel {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ignored"})
		return
	}

	task := worker.IssueTask{
		AccountID:    accountID,
		IssueNumber:  payload.Issue.Number,
		IssueTitle:   payload.Issue.Title,
		IssueBody:    payload.Issue.Body,
		RepoFullName: payload.Repository.FullName,
		CloneURL:     payload.Repository.CloneURL,
	}

	if err := h.dispatcher.Enqueue(task); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "queued",
		"issue":  payload.Issue.Number,
		"account": fmt.Sprintf("%.8s…", accountID),
	})
}

func validateSignature(secret, sigHeader string, body []byte) bool {
	if secret == "" {
		return true
	}
	if len(sigHeader) < 7 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(sigHeader), []byte(expected))
}

// ── GitHub payload types ──────────────────────

type issuePayload struct {
	Action     string     `json:"action"`
	Label      label      `json:"label"`
	Issue      issue      `json:"issue"`
	Repository repository `json:"repository"`
}

type label struct {
	Name string `json:"name"`
}

type issue struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	Body   string `json:"body"`
}

type repository struct {
	FullName string `json:"full_name"`
	CloneURL string `json:"clone_url"`
}

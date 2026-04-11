package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"

	"ai-pipeline/internal/config"
	"ai-pipeline/internal/worker"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	cfgMgr     *config.Manager
	dispatcher *worker.Dispatcher
}

func NewHandler(cfgMgr *config.Manager, dispatcher *worker.Dispatcher) *Handler {
	return &Handler{cfgMgr: cfgMgr, dispatcher: dispatcher}
}

func (h *Handler) Handle(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
		return
	}

	cfg := h.cfgMgr.Get()

	if !validateSignature(cfg.Github.WebhookSecret, c.GetHeader("X-Hub-Signature-256"), body) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}

	if c.GetHeader("X-GitHub-Event") != "issues" {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	var payload issuePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	if payload.Action != "labeled" || payload.Label.Name != cfg.Github.TriggerLabel {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	task := worker.IssueTask{
		IssueNumber:  payload.Issue.Number,
		IssueTitle:   payload.Issue.Title,
		IssueBody:    payload.Issue.Body,
		RepoFullName: payload.Repository.FullName,
		CloneURL:     payload.Repository.CloneURL,
	}

	if err := h.dispatcher.Enqueue(task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "queued", "issue": payload.Issue.Number})
}

func validateSignature(secret, sigHeader string, body []byte) bool {
	if secret == "" {
		return true // skip validation if secret not configured yet
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

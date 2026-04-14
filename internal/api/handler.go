package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"torch/internal/config"
	"torch/internal/githubclient"
	"torch/internal/livelog"
	"torch/internal/store"
	"torch/internal/worker"

	"github.com/hibiken/asynq"
)

const cubbitAPIBase = "https://api.eu00wi.cubbit.services"

// contextKey is the type used for values stored in request context.
type contextKey string

const ContextAccountID contextKey = "account_id"

type Handler struct {
	store      *store.Store
	inspector  *asynq.Inspector
	dispatcher *worker.Dispatcher
}

func NewHandler(st *store.Store, redisAddr string, dispatcher *worker.Dispatcher) *Handler {
	return &Handler{
		store:      st,
		inspector:  asynq.NewInspector(asynq.RedisClientOpt{Addr: redisAddr}),
		dispatcher: dispatcher,
	}
}

// accountID extracts the Cubbit account ID placed in context by authMiddleware.
func accountID(r *http.Request) string {
	v, _ := r.Context().Value(ContextAccountID).(string)
	return v
}

// ── Session exchange ──────────────────────────────────────────────────────────

// ExchangeSession verifies a Cubbit JWT against the Cubbit API, then creates
// and returns an opaque local session token stored in SQLite.
func (h *Handler) ExchangeSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CubbitToken string `json:"cubbit_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CubbitToken == "" {
		writeError(w, http.StatusBadRequest, "cubbit_token required")
		return
	}

	accountID, err := verifyCubbitJWT(r.Context(), req.CubbitToken)
	if err != nil {
		slog.Warn("cubbit JWT verification failed", "err", err)
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	sessionToken, err := h.store.CreateSession(accountID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	slog.Info("session created", "account_id", accountID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"session_token": sessionToken,
		"account_id":    accountID,
	})
}

// DeleteSession invalidates the caller's session (logout).
func (h *Handler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token != "" {
		h.store.DeleteSession(token) //nolint
	}
	w.WriteHeader(http.StatusNoContent)
}

// verifyCubbitJWT calls the Cubbit /account/me endpoint to confirm the JWT is
// valid, then extracts the account_id from the payload without trusting it
// blindly (Cubbit already validated the signature).
func verifyCubbitJWT(ctx context.Context, token string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		cubbitAPIBase+"/iam/v1/accounts/me", nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Cubbit API unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Cubbit rejected token (HTTP %d)", resp.StatusCode)
	}

	// JWT signature is valid (Cubbit just confirmed). Extract sub from payload.
	accountID := jwtSub(token)
	if accountID == "" {
		return "", fmt.Errorf("token has no sub claim")
	}
	return accountID, nil
}

// jwtSub decodes the JWT payload and returns the "sub" claim without verifying
// the signature (used only after Cubbit has already validated the token).
func jwtSub(tokenStr string) string {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return ""
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return ""
	}
	return claims.Sub
}

// ── Config ────────────────────────────────────────────────────────────────────

func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.store.GetConfig(accountID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

func (h *Handler) SaveConfig(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var cfg config.Config
	if err := json.Unmarshal(body, &cfg); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.store.SetConfig(accountID(r), cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "saved"})
}

// ── Pipeline control ──────────────────────────────────────────────────────────

func (h *Handler) StartPipeline(w http.ResponseWriter, r *http.Request) {
	h.setPipelineActive(w, r, true)
}

func (h *Handler) StopPipeline(w http.ResponseWriter, r *http.Request) {
	h.setPipelineActive(w, r, false)
}

func (h *Handler) setPipelineActive(w http.ResponseWriter, r *http.Request, active bool) {
	aid := accountID(r)
	cfg, err := h.store.GetConfig(aid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	cfg.Pipeline.Active = active
	if err := h.store.SetConfig(aid, cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	status := "started"
	if !active {
		status = "stopped"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": status})
}

// ── Status ────────────────────────────────────────────────────────────────────

type QueueStats struct {
	Pending   int `json:"pending"`
	Active    int `json:"active"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
}

type RunRecord struct {
	ID          string     `json:"id"`
	IssueNumber int        `json:"issue_number"`
	IssueTitle  string     `json:"issue_title"`
	Repo        string     `json:"repo"`
	Status      string     `json:"status"`
	Error       string     `json:"error,omitempty"`
	FailedAt    *time.Time `json:"failed_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type StatusResponse struct {
	Active bool        `json:"active"`
	Queue  QueueStats  `json:"queue"`
	Runs   []RunRecord `json:"runs"`
}

func (h *Handler) GetStatus(w http.ResponseWriter, r *http.Request) {
	aid := accountID(r)
	cfg, err := h.store.GetConfig(aid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	runs := h.listRuns(aid)

	// Build queue stats only from this user's runs
	var qs QueueStats
	for _, run := range runs {
		switch run.Status {
		case "pending":
			qs.Pending++
		case "active":
			qs.Active++
		case "completed":
			qs.Completed++
		case "failed":
			qs.Failed++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(StatusResponse{
		Active: cfg.Pipeline.Active,
		Queue:  qs,
		Runs:   runs,
	})
}

// listRuns returns Asynq tasks that belong to the given account, across all
// queues. Tasks are decoded from their JSON payload to check AccountID.
func (h *Handler) listRuns(aid string) []RunRecord {
	var runs []RunRecord

	collect := func(infos []*asynq.TaskInfo, fetchErr error, status string) {
		if fetchErr != nil {
			return
		}
		for _, t := range infos {
			var task worker.IssueTask
			if err := json.Unmarshal(t.Payload, &task); err != nil {
				continue
			}
			if task.AccountID != aid {
				continue
			}
			rec := RunRecord{
				ID:          t.ID,
				IssueNumber: task.IssueNumber,
				IssueTitle:  task.IssueTitle,
				Repo:        task.RepoFullName,
				Status:      status,
				Error:       t.LastErr,
			}
			if !t.LastFailedAt.IsZero() {
				rec.FailedAt = &t.LastFailedAt
			}
			if !t.CompletedAt.IsZero() {
				rec.CompletedAt = &t.CompletedAt
			}
			runs = append(runs, rec)
		}
	}

	page := asynq.PageSize(50)
	active, err := h.inspector.ListActiveTasks("default", page)
	collect(active, err, "active")
	pending, err := h.inspector.ListPendingTasks("default", page)
	collect(pending, err, "pending")
	retrying, err := h.inspector.ListRetryTasks("default", page)
	collect(retrying, err, "retrying")
	completed, err := h.inspector.ListCompletedTasks("default", page)
	collect(completed, err, "completed")
	archived, err := h.inspector.ListArchivedTasks("default", page)
	collect(archived, err, "failed")

	return runs
}

// ── Issues ────────────────────────────────────────────────────────────────────

func (h *Handler) ListUserRepos(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.store.GetConfig(accountID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cfg.Github.Token == "" {
		writeError(w, http.StatusBadRequest, "GitHub token not configured")
		return
	}
	repos, err := githubclient.NewClient(cfg.Github.Token).ListUserRepos(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if repos == nil {
		repos = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}

func (h *Handler) ListIssues(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("repo")
	if repo == "" {
		writeError(w, http.StatusBadRequest, "repo parameter required")
		return
	}
	cfg, err := h.store.GetConfig(accountID(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if cfg.Github.Token == "" {
		writeError(w, http.StatusBadRequest, "GitHub token not configured")
		return
	}
	client := githubclient.NewClient(cfg.Github.Token)
	issues, err := client.ListIssues(r.Context(), repo)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(issues)
}

type TriggerRequest struct {
	RepoFullName string `json:"repo_full_name"`
	IssueNumber  int    `json:"issue_number"`
	IssueTitle   string `json:"issue_title"`
	IssueBody    string `json:"issue_body"`
}

func (h *Handler) TriggerIssue(w http.ResponseWriter, r *http.Request) {
	var req TriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.RepoFullName == "" || req.IssueNumber == 0 {
		writeError(w, http.StatusBadRequest, "repo_full_name and issue_number required")
		return
	}

	task := worker.IssueTask{
		AccountID:    accountID(r),
		IssueNumber:  req.IssueNumber,
		IssueTitle:   req.IssueTitle,
		IssueBody:    req.IssueBody,
		RepoFullName: req.RepoFullName,
		CloneURL:     fmt.Sprintf("https://github.com/%s.git", req.RepoFullName),
	}
	if err := h.dispatcher.Enqueue(task); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "queued", "issue": req.IssueNumber})
}

// ── Live log ──────────────────────────────────────────────────────────────────

func (h *Handler) GetLiveLog(w http.ResponseWriter, r *http.Request) {
	issueStr := r.URL.Query().Get("issue")
	issueNum, err := strconv.Atoi(issueStr)
	if err != nil || issueNum <= 0 {
		writeError(w, http.StatusBadRequest, "issue parameter required")
		return
	}
	lines := livelog.Get(issueNum)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lines)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

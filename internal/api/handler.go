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
	store         *store.Store
	inspector     *asynq.Inspector
	dispatcher    *worker.Dispatcher
	adminEmail    string
	allowedDomain string // only emails from this domain can log in; empty = allow all
}

func NewHandler(st *store.Store, redisAddr string, dispatcher *worker.Dispatcher, adminEmail, allowedDomain string) *Handler {
	return &Handler{
		store:         st,
		inspector:     asynq.NewInspector(asynq.RedisClientOpt{Addr: redisAddr}),
		dispatcher:    dispatcher,
		adminEmail:    adminEmail,
		allowedDomain: allowedDomain,
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

	accountID, email, err := verifyCubbitJWT(r.Context(), req.CubbitToken)
	if err != nil {
		slog.Warn("cubbit JWT verification failed", "err", err)
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// Enforce domain allowlist if configured.
	if h.allowedDomain != "" && !strings.HasSuffix(email, "@"+h.allowedDomain) {
		slog.Warn("login rejected: email not in allowed domain", "email", email, "allowed", h.allowedDomain)
		writeError(w, http.StatusForbidden, "account not allowed")
		return
	}

	isAdmin := h.adminEmail != "" && email == h.adminEmail
	sessionToken, err := h.store.CreateSession(accountID, isAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if email != "" {
		h.store.SaveEmail(accountID, email) //nolint
	}

	slog.Info("session created", "account_id", accountID, "email", email, "is_admin", isAdmin)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"session_token": sessionToken,
		"account_id":    accountID,
		"is_admin":      isAdmin,
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

// verifyCubbitJWT calls the Cubbit /accounts/me endpoint to confirm the JWT is
// valid. It returns the account_id (sub claim) and the email from the API response.
func verifyCubbitJWT(ctx context.Context, token string) (accountID, email string, err error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		cubbitAPIBase+"/iam/v1/accounts/me", nil)
	if err != nil {
		return "", "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("Cubbit API unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("Cubbit rejected token (HTTP %d)", resp.StatusCode)
	}

	// Read the API response body — Cubbit returns account info here.
	bodyBytes, _ := io.ReadAll(resp.Body)
	slog.Debug("cubbit /accounts/me response", "body", string(bodyBytes))

	// Extract email from Cubbit response: emails[] array, pick the default one.
	var apiResp struct {
		Emails []struct {
			Email   string `json:"email"`
			Default bool   `json:"default"`
		} `json:"emails"`
	}
	if err := json.Unmarshal(bodyBytes, &apiResp); err == nil {
		for _, e := range apiResp.Emails {
			if e.Default && e.Email != "" {
				email = e.Email
				break
			}
		}
		// Fallback: first entry if none is marked default.
		if email == "" && len(apiResp.Emails) > 0 {
			email = apiResp.Emails[0].Email
		}
	}

	accountID, _ = jwtClaims(token)
	if accountID == "" {
		return "", "", fmt.Errorf("token has no sub claim")
	}
	slog.Debug("identity resolved", "sub", accountID, "email", email)
	return accountID, email, nil
}

// jwtClaims decodes the JWT payload and returns the "sub" and "email" claims
// without verifying the signature (safe: called only after Cubbit validated the token).
// Falls back to "preferred_username" if "email" is absent.
func jwtClaims(tokenStr string) (sub, email string) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return "", ""
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", ""
	}
	var claims struct {
		Sub               string `json:"sub"`
		Email             string `json:"email"`
		PreferredUsername string `json:"preferred_username"`
	}
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return "", ""
	}
	email = claims.Email
	if email == "" {
		email = claims.PreferredUsername
	}
	return claims.Sub, email
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

// ── Admin ─────────────────────────────────────────────────────────────────────

type adminRunRecord struct {
	ID          string  `json:"id"`
	AccountID   string  `json:"account_id"`
	Repo        string  `json:"repo"`
	IssueNumber int     `json:"issue_number"`
	IssueTitle  string  `json:"issue_title"`
	Status      string  `json:"status"`
	StartedAt   int64   `json:"started_at"`
	FinishedAt  *int64  `json:"finished_at,omitempty"`
	DurationSec *int64  `json:"duration_sec,omitempty"`
	ErrorMsg    string  `json:"error,omitempty"`
	PRURL       string  `json:"pr_url,omitempty"`
}

func toAdminRunRecord(r store.RunRow) adminRunRecord {
	rec := adminRunRecord{
		ID:          r.ID,
		AccountID:   r.AccountID,
		Repo:        r.Repo,
		IssueNumber: r.IssueNumber,
		IssueTitle:  r.IssueTitle,
		Status:      r.Status,
		StartedAt:   r.StartedAt,
		FinishedAt:  r.FinishedAt,
		ErrorMsg:    r.ErrorMsg,
		PRURL:       r.PRURL,
	}
	if r.FinishedAt != nil {
		d := *r.FinishedAt - r.StartedAt
		rec.DurationSec = &d
	}
	return rec
}

// AdminGetRuns returns the 200 most recent runs across all users.
func (h *Handler) AdminGetRuns(w http.ResponseWriter, r *http.Request) {
	rows, err := h.store.ListAllRuns(200)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]adminRunRecord, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAdminRunRecord(row))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// AdminGetUsers returns per-user run statistics.
func (h *Handler) AdminGetUsers(w http.ResponseWriter, r *http.Request) {
	stats, err := h.store.GetUserStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// AdminGetStats returns aggregated counters across all users.
func (h *Handler) AdminGetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.store.GetAdminStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

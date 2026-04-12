package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"torch/internal/config"
	"torch/internal/githubclient"
	"torch/internal/livelog"
	"torch/internal/worker"

	"github.com/hibiken/asynq"
)

type Handler struct {
	mgr        *config.Manager
	inspector  *asynq.Inspector
	dispatcher *worker.Dispatcher
}

func NewHandler(mgr *config.Manager, redisAddr string, dispatcher *worker.Dispatcher) *Handler {
	return &Handler{
		mgr:        mgr,
		inspector:  asynq.NewInspector(asynq.RedisClientOpt{Addr: redisAddr}),
		dispatcher: dispatcher,
	}
}

// ── Config ────────────────────────────────────────────────────────────────────

func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.mgr.Get())
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
	if err := h.mgr.Set(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "saved"})
}

// ── Pipeline control ──────────────────────────────────────────────────────────

func (h *Handler) StartPipeline(w http.ResponseWriter, r *http.Request) {
	h.setPipelineActive(w, true)
}

func (h *Handler) StopPipeline(w http.ResponseWriter, r *http.Request) {
	h.setPipelineActive(w, false)
}

func (h *Handler) setPipelineActive(w http.ResponseWriter, active bool) {
	cfg := h.mgr.Get()
	cfg.Pipeline.Active = active
	if err := h.mgr.Set(cfg); err != nil {
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
	Status      string     `json:"status"` // active | pending | retrying | completed | failed
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
	cfg := h.mgr.Get()

	var qs QueueStats
	if info, err := h.inspector.GetQueueInfo("default"); err == nil {
		qs.Pending   = info.Pending
		qs.Active    = info.Active
		qs.Completed = info.Completed
		qs.Failed    = info.Failed
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(StatusResponse{
		Active: cfg.Pipeline.Active,
		Queue:  qs,
		Runs:   h.listRuns(),
	})
}

func (h *Handler) listRuns() []RunRecord {
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
			r := RunRecord{
				ID:          t.ID,
				IssueNumber: task.IssueNumber,
				IssueTitle:  task.IssueTitle,
				Repo:        task.RepoFullName,
				Status:      status,
				Error:       t.LastErr,
			}
			if !t.LastFailedAt.IsZero() {
				r.FailedAt = &t.LastFailedAt
			}
			if !t.CompletedAt.IsZero() {
				r.CompletedAt = &t.CompletedAt
			}
			runs = append(runs, r)
		}
	}

	page := asynq.PageSize(50)
	active,    err := h.inspector.ListActiveTasks("default", page);    collect(active,    err, "active")
	pending,   err := h.inspector.ListPendingTasks("default", page);   collect(pending,   err, "pending")
	retrying,  err := h.inspector.ListRetryTasks("default", page);     collect(retrying,  err, "retrying")
	completed, err := h.inspector.ListCompletedTasks("default", page); collect(completed, err, "completed")
	archived,  err := h.inspector.ListArchivedTasks("default", page);  collect(archived,  err, "failed")

	return runs
}

// ── Issues ────────────────────────────────────────────────────────────────────

func (h *Handler) ListIssues(w http.ResponseWriter, r *http.Request) {
	repo := r.URL.Query().Get("repo")
	if repo == "" {
		writeError(w, http.StatusBadRequest, "repo parameter required")
		return
	}
	cfg := h.mgr.Get()
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

// ── Live log ─────────────────────────────────────────────────────────────────

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

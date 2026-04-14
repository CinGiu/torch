package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"torch/internal/config"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
	mu sync.RWMutex
}

func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// Single writer — avoids SQLITE_BUSY under concurrent requests
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS user_configs (
			account_id  TEXT PRIMARY KEY,
			config_json TEXT NOT NULL DEFAULT '{}',
			updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE IF NOT EXISTS sessions (
			id         TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			is_admin   INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS runs (
			id           TEXT PRIMARY KEY,
			account_id   TEXT NOT NULL,
			repo         TEXT NOT NULL,
			issue_number INTEGER NOT NULL,
			issue_title  TEXT NOT NULL DEFAULT '',
			status       TEXT NOT NULL DEFAULT 'running',
			started_at   INTEGER NOT NULL,
			finished_at  INTEGER,
			error_msg    TEXT NOT NULL DEFAULT '',
			pr_url       TEXT NOT NULL DEFAULT ''
		);
		CREATE INDEX IF NOT EXISTS runs_account_id ON runs(account_id);
		CREATE INDEX IF NOT EXISTS runs_started_at  ON runs(started_at);
	`)
	return err
}

// ── Sessions ──────────────────────────────────────────────────────────────────

// CreateSession generates a new opaque session token for accountID (7-day TTL).
// isAdmin marks the session as having admin privileges.
func (s *Store) CreateSession(accountID string, isAdmin bool) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := uuid.New().String()
	expiresAt := time.Now().Add(7 * 24 * time.Hour).Unix()
	adminFlag := 0
	if isAdmin {
		adminFlag = 1
	}
	_, err := s.db.Exec(`INSERT INTO sessions (id, account_id, expires_at, is_admin) VALUES (?, ?, ?, ?)`,
		id, accountID, expiresAt, adminFlag)
	return id, err
}

// IsAdminSession returns true if the session token belongs to an admin.
func (s *Store) IsAdminSession(token string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var isAdmin int
	var expiresAt int64
	err := s.db.QueryRow(`SELECT is_admin, expires_at FROM sessions WHERE id = ?`, token).
		Scan(&isAdmin, &expiresAt)
	if err != nil {
		return false, err
	}
	if time.Now().Unix() > expiresAt {
		return false, fmt.Errorf("session expired")
	}
	return isAdmin == 1, nil
}

// GetAccountBySession returns the account_id for a valid, non-expired session.
func (s *Store) GetAccountBySession(token string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var accountID string
	var expiresAt int64
	err := s.db.QueryRow(`SELECT account_id, expires_at FROM sessions WHERE id = ?`, token).
		Scan(&accountID, &expiresAt)
	if err != nil {
		return "", fmt.Errorf("session not found")
	}
	if time.Now().Unix() > expiresAt {
		go s.db.Exec(`DELETE FROM sessions WHERE id = ?`, token) //nolint
		return "", fmt.Errorf("session expired")
	}
	return accountID, nil
}

// DeleteSession invalidates a session (logout).
func (s *Store) DeleteSession(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, token)
	return err
}

// GetConfig returns the stored config for accountID, or a default config if
// no record exists yet.
func (s *Store) GetConfig(accountID string) (config.Config, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var raw string
	err := s.db.QueryRow(`SELECT config_json FROM user_configs WHERE account_id = ?`, accountID).Scan(&raw)
	if err == sql.ErrNoRows {
		return config.DefaultConfig(), nil
	}
	if err != nil {
		return config.Config{}, fmt.Errorf("query: %w", err)
	}

	// Start from defaults so any new fields are always present
	cfg := config.DefaultConfig()
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return config.Config{}, fmt.Errorf("unmarshal: %w", err)
	}
	return cfg, nil
}

// SetConfig persists the config for accountID (upsert).
func (s *Store) SetConfig(accountID string, cfg config.Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	_, err = s.db.Exec(`
		INSERT INTO user_configs (account_id, config_json, updated_at)
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(account_id) DO UPDATE SET
			config_json = excluded.config_json,
			updated_at  = excluded.updated_at`,
		accountID, string(data))
	return err
}

// ── Runs ──────────────────────────────────────────────────────────────────────

type RunRow struct {
	ID          string
	AccountID   string
	Repo        string
	IssueNumber int
	IssueTitle  string
	Status      string // running | completed | failed
	StartedAt   int64
	FinishedAt  *int64
	ErrorMsg    string
	PRURL       string
}

type UserStat struct {
	AccountID string
	Total     int
	Completed int
	Failed    int
	LastRunAt *int64
}

type AdminStats struct {
	TotalUsers int `json:"total_users"`
	TotalRuns  int `json:"total_runs"`
	RunsToday  int `json:"runs_today"`
	Completed  int `json:"completed"`
	Failed     int `json:"failed"`
	Running    int `json:"running"`
}

// StartRun records a new pipeline run as "running". Returns the run UUID.
func (s *Store) StartRun(accountID, repo string, issueNumber int, issueTitle string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := uuid.New().String()
	_, err := s.db.Exec(`
		INSERT INTO runs (id, account_id, repo, issue_number, issue_title, status, started_at)
		VALUES (?, ?, ?, ?, ?, 'running', ?)`,
		id, accountID, repo, issueNumber, issueTitle, time.Now().Unix())
	return id, err
}

// FinishRun marks a run as completed or failed with an optional PR URL.
func (s *Store) FinishRun(runID, status, errMsg, prURL string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		UPDATE runs SET status=?, finished_at=?, error_msg=?, pr_url=? WHERE id=?`,
		status, time.Now().Unix(), errMsg, prURL, runID)
	return err
}

// ListRuns returns the most recent runs for a single account (newest first).
func (s *Store) ListRuns(accountID string, limit int) ([]RunRow, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.db.Query(`
		SELECT id, account_id, repo, issue_number, issue_title, status,
		       started_at, finished_at, error_msg, pr_url
		FROM runs WHERE account_id = ?
		ORDER BY started_at DESC LIMIT ?`, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRuns(rows)
}

// ListAllRuns returns the most recent runs across all accounts (admin).
func (s *Store) ListAllRuns(limit int) ([]RunRow, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.db.Query(`
		SELECT id, account_id, repo, issue_number, issue_title, status,
		       started_at, finished_at, error_msg, pr_url
		FROM runs ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRuns(rows)
}

// GetAdminStats returns aggregated run counters across all users.
func (s *Store) GetAdminStats() (AdminStats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var st AdminStats
	dayAgo := time.Now().Add(-24 * time.Hour).Unix()
	err := s.db.QueryRow(`
		SELECT
			COUNT(DISTINCT account_id),
			COUNT(*),
			SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END),
			SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
			SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END),
			SUM(CASE WHEN status = 'running'   THEN 1 ELSE 0 END)
		FROM runs`, dayAgo).Scan(
		&st.TotalUsers, &st.TotalRuns, &st.RunsToday,
		&st.Completed, &st.Failed, &st.Running)
	return st, err
}

// GetUserStats returns per-account run summaries (admin).
func (s *Store) GetUserStats() ([]UserStat, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.db.Query(`
		SELECT account_id,
		       COUNT(*),
		       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
		       SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END),
		       MAX(started_at)
		FROM runs GROUP BY account_id ORDER BY MAX(started_at) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserStat
	for rows.Next() {
		var u UserStat
		if err := rows.Scan(&u.AccountID, &u.Total, &u.Completed, &u.Failed, &u.LastRunAt); err != nil {
			continue
		}
		out = append(out, u)
	}
	return out, nil
}

func scanRuns(rows *sql.Rows) ([]RunRow, error) {
	var out []RunRow
	for rows.Next() {
		var r RunRow
		if err := rows.Scan(&r.ID, &r.AccountID, &r.Repo, &r.IssueNumber, &r.IssueTitle,
			&r.Status, &r.StartedAt, &r.FinishedAt, &r.ErrorMsg, &r.PRURL); err != nil {
			continue
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetAllConfigs returns all stored user configs, keyed by account_id.
// Used by the webhook handler to find the user whose repo triggered the event.
func (s *Store) GetAllConfigs() (map[string]config.Config, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`SELECT account_id, config_json FROM user_configs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]config.Config{}
	for rows.Next() {
		var accountID, raw string
		if err := rows.Scan(&accountID, &raw); err != nil {
			continue
		}
		cfg := config.DefaultConfig()
		if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
			continue
		}
		result[accountID] = cfg
	}
	return result, nil
}

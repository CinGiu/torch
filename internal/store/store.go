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
			expires_at INTEGER NOT NULL
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
	if err != nil {
		return err
	}
	// Additive column migrations — safe to re-run on an existing DB.
	// SQLite returns an error if the column already exists; we ignore it.
	s.db.Exec(`ALTER TABLE sessions ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`)      //nolint
	s.db.Exec(`ALTER TABLE user_configs ADD COLUMN email TEXT NOT NULL DEFAULT ''`)       //nolint
	return nil
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

// SaveEmail persists the email address for an account (upsert, email-only update).
// Called at login so the email is always up to date even if the user never saves config.
func (s *Store) SaveEmail(accountID, email string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO user_configs (account_id, email, config_json, updated_at)
		VALUES (?, ?, '{}', datetime('now'))
		ON CONFLICT(account_id) DO UPDATE SET email = excluded.email`,
		accountID, email)
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
	AccountID string `json:"account_id"`
	Email     string `json:"email"`
	Total     int    `json:"total"`
	Completed int    `json:"completed"`
	Failed    int    `json:"failed"`
	LastRunAt *int64 `json:"last_run_at"`
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
// TotalUsers counts distinct accounts from sessions+user_configs (not just runs).
func (s *Store) GetAdminStats() (AdminStats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var st AdminStats
	dayAgo := time.Now().Add(-24 * time.Hour).Unix()

	// Count known users from sessions and user_configs, not just from runs.
	if err := s.db.QueryRow(`
		SELECT COUNT(*) FROM (
			SELECT account_id FROM sessions
			UNION
			SELECT account_id FROM user_configs
		)`).Scan(&st.TotalUsers); err != nil {
		return st, err
	}

	err := s.db.QueryRow(`
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'running'   THEN 1 ELSE 0 END), 0)
		FROM runs`, dayAgo).Scan(
		&st.TotalRuns, &st.RunsToday,
		&st.Completed, &st.Failed, &st.Running)
	return st, err
}

// GetUserStats returns per-account summaries for all known users (admin).
// Includes users who have logged in or saved config, even with zero runs.
func (s *Store) GetUserStats() ([]UserStat, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.db.Query(`
		SELECT
			a.account_id,
			COALESCE(uc.email, ''),
			COALESCE(COUNT(r.id), 0),
			COALESCE(SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN r.status = 'failed'    THEN 1 ELSE 0 END), 0),
			MAX(r.started_at)
		FROM (
			SELECT account_id FROM sessions
			UNION
			SELECT account_id FROM user_configs
		) a
		LEFT JOIN user_configs uc ON uc.account_id = a.account_id
		LEFT JOIN runs r ON r.account_id = a.account_id
		GROUP BY a.account_id
		ORDER BY MAX(r.started_at) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserStat
	for rows.Next() {
		var u UserStat
		if err := rows.Scan(&u.AccountID, &u.Email, &u.Total, &u.Completed, &u.Failed, &u.LastRunAt); err != nil {
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

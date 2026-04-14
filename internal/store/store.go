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
	`)
	return err
}

// ── Sessions ──────────────────────────────────────────────────────────────────

// CreateSession generates a new opaque session token for accountID (7-day TTL).
func (s *Store) CreateSession(accountID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := uuid.New().String()
	expiresAt := time.Now().Add(7 * 24 * time.Hour).Unix()
	_, err := s.db.Exec(`INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)`,
		id, accountID, expiresAt)
	return id, err
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

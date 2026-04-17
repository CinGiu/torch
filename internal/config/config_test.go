package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// getEnv returns the value for key in an env slice (KEY=VALUE format).
func getEnv(env []string, key string) (string, bool) {
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return e[len(prefix):], true
		}
	}
	return "", false
}

func TestSetEnv(t *testing.T) {
	t.Run("replaces existing key", func(t *testing.T) {
		env := []string{"FOO=old", "BAR=baz"}
		got := setEnv(env, "FOO", "new")
		v, ok := getEnv(got, "FOO")
		if !ok || v != "new" {
			t.Errorf("FOO = %q (found=%v), want %q", v, ok, "new")
		}
		if len(got) != 2 {
			t.Errorf("expected 2 entries, got %d", len(got))
		}
	})

	t.Run("appends new key", func(t *testing.T) {
		env := []string{"FOO=bar"}
		got := setEnv(env, "NEW_KEY", "val")
		v, ok := getEnv(got, "NEW_KEY")
		if !ok || v != "val" {
			t.Errorf("NEW_KEY = %q (found=%v), want %q", v, ok, "val")
		}
		if len(got) != 2 {
			t.Errorf("expected 2 entries, got %d", len(got))
		}
	})
}

func TestMergedEnv_Claude(t *testing.T) {
	cfg := AgentConfig{CLI: "claude", APIKey: "tok123"}

	got := cfg.MergedEnv(nil)

	v, ok := getEnv(got, "CLAUDE_CODE_OAUTH_TOKEN")
	if !ok || v != "tok123" {
		t.Errorf("CLAUDE_CODE_OAUTH_TOKEN = %q (found=%v), want %q", v, ok, "tok123")
	}
}

func TestMergedEnv_ClaudeNoToken(t *testing.T) {
	// With empty APIKey, the variable should not be forced into the env.
	// (It may still be present from the process env, but we can't control that.)
	cfg := AgentConfig{CLI: "claude", APIKey: ""}
	// Just confirm MergedEnv doesn't panic and returns a non-nil slice.
	got := cfg.MergedEnv(nil)
	if got == nil {
		t.Fatal("MergedEnv returned nil")
	}
}

func TestMergedEnv_Opencode(t *testing.T) {
	cfg := AgentConfig{
		CLI:     "opencode",
		APIKey:  "mykey",
		BaseURL: "http://localhost:8080",
		Model:   "gpt-4o",
	}

	got := cfg.MergedEnv(nil)

	checks := map[string]string{
		"OPENCODE_API_KEY":  "mykey",
		"OPENCODE_BASE_URL": "http://localhost:8080",
		"OPENCODE_MODEL":    "gpt-4o",
	}
	for k, want := range checks {
		v, ok := getEnv(got, k)
		if !ok || v != want {
			t.Errorf("%s = %q (found=%v), want %q", k, v, ok, want)
		}
	}
}

func TestMergedEnv_PathPrepend(t *testing.T) {
	cfg := AgentConfig{CLI: "claude"}
	extra := map[string]string{"PATH": "/custom/bin"}

	got := cfg.MergedEnv(extra)

	v, ok := getEnv(got, "PATH")
	if !ok {
		t.Fatal("PATH not found in merged env")
	}
	// The custom prefix should appear first.
	if !strings.HasPrefix(v, "/custom/bin") {
		t.Errorf("PATH = %q; expected it to start with /custom/bin", v)
	}
	// The original PATH should still be present.
	systemPath := os.Getenv("PATH")
	if systemPath != "" && !strings.Contains(v, systemPath) {
		t.Errorf("PATH = %q; expected to contain system PATH %q", v, systemPath)
	}
}

func TestMergedEnv_ExtraEnvOverrides(t *testing.T) {
	cfg := AgentConfig{CLI: "claude"}
	extra := map[string]string{"MY_VAR": "from_extra"}

	got := cfg.MergedEnv(extra)

	v, ok := getEnv(got, "MY_VAR")
	if !ok || v != "from_extra" {
		t.Errorf("MY_VAR = %q (found=%v), want %q", v, ok, "from_extra")
	}
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.Pipeline.MaxFixRounds <= 0 {
		t.Errorf("MaxFixRounds should be positive, got %d", cfg.Pipeline.MaxFixRounds)
	}
	if cfg.Pipeline.WorkspacesDir == "" {
		t.Error("WorkspacesDir should not be empty")
	}
	if cfg.Github.TriggerLabel == "" {
		t.Error("TriggerLabel should not be empty")
	}
	for _, role := range []string{"developer", "tester", "reviewer"} {
		a, ok := cfg.Agents[role]
		if !ok {
			t.Errorf("missing agent %q in default config", role)
			continue
		}
		if a.CLI == "" {
			t.Errorf("agent %q has empty CLI", role)
		}
		if a.TimeoutSecs <= 0 {
			t.Errorf("agent %q has non-positive TimeoutSecs: %d", role, a.TimeoutSecs)
		}
	}
}

func TestManager_CreateDefaultWhenMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// File should have been created.
	if _, err := os.Stat(path); err != nil {
		t.Errorf("config file not created: %v", err)
	}

	cfg := m.Get()
	def := DefaultConfig()
	if cfg.Pipeline.MaxFixRounds != def.Pipeline.MaxFixRounds {
		t.Errorf("MaxFixRounds = %d, want %d", cfg.Pipeline.MaxFixRounds, def.Pipeline.MaxFixRounds)
	}
}

func TestManager_LoadExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	// Write a minimal config file.
	data := []byte(`{"pipeline":{"max_fix_rounds":7,"workspaces_dir":"/tmp/ws","active":true}}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	cfg := m.Get()
	if cfg.Pipeline.MaxFixRounds != 7 {
		t.Errorf("MaxFixRounds = %d, want 7", cfg.Pipeline.MaxFixRounds)
	}
	if cfg.Pipeline.WorkspacesDir != "/tmp/ws" {
		t.Errorf("WorkspacesDir = %q, want /tmp/ws", cfg.Pipeline.WorkspacesDir)
	}
	if !cfg.Pipeline.Active {
		t.Error("Active should be true")
	}
}

func TestManager_DefaultsMergedWithPartialConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	// Config with only pipeline fields set — agents should come from defaults.
	data := []byte(`{"pipeline":{"max_fix_rounds":5}}`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	cfg := m.Get()
	if _, ok := cfg.Agents["developer"]; !ok {
		t.Error("developer agent missing — defaults not merged")
	}
}

func TestManager_SetAndGet(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	updated := m.Get()
	updated.Pipeline.MaxFixRounds = 99
	updated.Github.TriggerLabel = "my-label"

	if err := m.Set(updated); err != nil {
		t.Fatalf("Set: %v", err)
	}

	got := m.Get()
	if got.Pipeline.MaxFixRounds != 99 {
		t.Errorf("MaxFixRounds = %d, want 99", got.Pipeline.MaxFixRounds)
	}
	if got.Github.TriggerLabel != "my-label" {
		t.Errorf("TriggerLabel = %q, want my-label", got.Github.TriggerLabel)
	}
}

func TestManager_SetPersistsToDisk(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	m, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	updated := m.Get()
	updated.Pipeline.MaxFixRounds = 42
	if err := m.Set(updated); err != nil {
		t.Fatalf("Set: %v", err)
	}

	// Open a fresh Manager from the same file.
	m2, err := NewManager(path)
	if err != nil {
		t.Fatalf("NewManager (reload): %v", err)
	}
	if m2.Get().Pipeline.MaxFixRounds != 42 {
		t.Errorf("after reload MaxFixRounds = %d, want 42", m2.Get().Pipeline.MaxFixRounds)
	}
}

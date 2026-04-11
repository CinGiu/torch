package config

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Config struct {
	Pipeline PipelineConfig         `json:"pipeline"`
	Github   GithubConfig           `json:"github"`
	Agents   map[string]AgentConfig `json:"agents"`
}

type PipelineConfig struct {
	WorkspacesDir string `json:"workspaces_dir"`
	MaxFixRounds  int    `json:"max_fix_rounds"`
}

type GithubConfig struct {
	Token         string `json:"token"`
	WebhookSecret string `json:"webhook_secret"`
	TriggerLabel  string `json:"trigger_label"`
	BaseBranch    string `json:"base_branch"`
}

type AgentConfig struct {
	CLI          string   `json:"cli"`
	Args         []string `json:"args"`
	APIKey       string   `json:"api_key"`
	BaseURL      string   `json:"base_url"`
	Model        string   `json:"model"`
	SystemPrompt string   `json:"system_prompt"`
	MaxFixRounds int      `json:"max_fix_rounds"`
}

// MergedEnv builds the env slice for exec.Cmd, injecting the right
// credentials depending on which CLI is configured.
func (a *AgentConfig) MergedEnv() []string {
	env := os.Environ()

	switch a.CLI {
	case "claude":
		if a.APIKey != "" {
			env = setEnv(env, "ANTHROPIC_API_KEY", a.APIKey)
		}
	case "opencode":
		if a.APIKey != "" {
			env = setEnv(env, "OPENCODE_API_KEY", a.APIKey)
		}
		if a.BaseURL != "" {
			env = setEnv(env, "OPENCODE_BASE_URL", a.BaseURL)
		}
		if a.Model != "" {
			env = setEnv(env, "OPENCODE_MODEL", a.Model)
		}
	}

	return env
}

func setEnv(env []string, key, value string) []string {
	prefix := key + "="
	for i, e := range env {
		if len(e) > len(prefix) && e[:len(prefix)] == prefix {
			env[i] = key + "=" + value
			return env
		}
	}
	return append(env, key+"="+value)
}

// ──────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────

func defaultConfig() Config {
	return Config{
		Pipeline: PipelineConfig{
			WorkspacesDir: "/workspaces",
			MaxFixRounds:  3,
		},
		Github: GithubConfig{
			TriggerLabel: "ai-implement",
			BaseBranch:   "main",
		},
		Agents: map[string]AgentConfig{
			"developer": {
				CLI:          "claude",
				Args:         []string{"--print", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep", "--max-turns", "40"},
				MaxFixRounds: 3,
				SystemPrompt: defaultDeveloperPrompt,
			},
			"tester": {
				CLI:          "claude",
				Args:         []string{"--print", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"},
				MaxFixRounds: 3,
				SystemPrompt: defaultTesterPrompt,
			},
			"reviewer": {
				CLI:          "claude",
				Args:         []string{"--print", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"},
				MaxFixRounds: 3,
				SystemPrompt: defaultReviewerPrompt,
			},
		},
	}
}

// ──────────────────────────────────────────────
// Manager
// ──────────────────────────────────────────────

type Manager struct {
	mu   sync.RWMutex
	path string
	cfg  Config
}

func NewManager(path string) (*Manager, error) {
	m := &Manager{path: path}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		m.cfg = defaultConfig()
		return m, m.save()
	}
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	// Start with defaults so new fields are always populated
	m.cfg = defaultConfig()
	if err := json.Unmarshal(data, &m.cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	return m, nil
}

func (m *Manager) Get() Config {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

func (m *Manager) Set(cfg Config) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cfg = cfg
	return m.save()
}

func (m *Manager) save() error {
	data, err := json.MarshalIndent(m.cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(fmt.Sprintf("%s/..", m.path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(m.path, data, 0o600)
}

// ──────────────────────────────────────────────
// Default prompts
// ──────────────────────────────────────────────

const defaultDeveloperPrompt = `You are an expert Flutter developer working on a production app.

Your task:
1. Explore the codebase — understand existing patterns, architecture, naming conventions
2. Implement the feature described in the issue
3. Write appropriate tests (unit or widget)
4. Run 'flutter analyze' — fix ALL warnings and errors
5. Run 'flutter test' — all tests must pass
6. Stage all changes with 'git add .'

Rules:
- Match existing code style exactly
- Minimal, focused changes — do not over-engineer
- Do not modify pubspec.yaml unless strictly necessary
- Never break existing tests
- Do NOT commit — only stage changes`

const defaultTesterPrompt = `You are a senior Flutter QA engineer.

Steps:
1. Read the issue description and understand expected behavior
2. Review all staged/modified files (use 'git diff --staged')
3. Run 'flutter analyze' and report any issues
4. Run 'flutter test' and report any failures
5. Check test coverage — are new features adequately tested?
6. Check edge cases — are they handled?

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "detailed description of what must be fixed (empty if success)",
  "issues": ["issue 1", "issue 2"]
}

Be strict. If tests are missing or coverage is inadequate, return failed.`

const defaultReviewerPrompt = `You are a senior Flutter architect doing a code review.

Steps:
1. Run 'git diff --staged' to see all changes
2. Review for: correctness, code quality, architecture, security, performance
3. Check that implementation matches the issue requirements exactly
4. Verify naming conventions and code style match the existing codebase

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "detailed list of required changes (empty if success)",
  "comments": ["comment 1", "comment 2"]
}

Be constructive but strict. Reject if there are architectural issues or missing requirements.`

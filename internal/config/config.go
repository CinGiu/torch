package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	WorkspacesDir  string            `json:"workspaces_dir"`
	MaxFixRounds   int               `json:"max_fix_rounds"`
	TestCommand    string            `json:"test_command"`
	LintCommand    string            `json:"lint_command"`
	Active         bool              `json:"active"`
	KeepWorkspace  bool              `json:"keep_workspace,omitempty"`
	OpencodeConfig string            `json:"opencode_config,omitempty"`
	ExtraEnv       map[string]string `json:"extra_env,omitempty"` // injected into every agent process (e.g. PATH additions)
}

type GithubConfig struct {
	Token         string   `json:"token"`
	WebhookSecret string   `json:"webhook_secret"`
	TriggerLabel  string   `json:"trigger_label"`
	BaseBranch    string   `json:"base_branch"`
	Repos         []string `json:"repos"`
}

type AgentConfig struct {
	CLI          string   `json:"cli"`
	Args         []string `json:"args"`
	APIKey       string   `json:"api_key"`
	BaseURL      string   `json:"base_url"`
	Model        string   `json:"model"`
	SystemPrompt string   `json:"system_prompt"`
	MaxFixRounds int      `json:"max_fix_rounds"`
	TimeoutSecs  int      `json:"timeout_secs"` // 0 = use default (1800)
}

// MergedEnv builds the env slice for exec.Cmd, injecting credentials and
// any extra env vars from the pipeline config (e.g. PATH additions).
func (a *AgentConfig) MergedEnv(extraEnv map[string]string) []string {
	env := os.Environ()

	// Inject extra env vars first (e.g. prepend to PATH)
	for k, v := range extraEnv {
		if k == "PATH" {
			// Prepend to existing PATH rather than replace
			existing := os.Getenv("PATH")
			if existing != "" {
				v = v + ":" + existing
			}
		}
		env = setEnv(env, k, v)
	}

	switch a.CLI {
	case "claude":
		// If a token is explicitly set (remote server), inject it.
		// Otherwise auth comes from ~/.claude mounted into the container.
		if a.APIKey != "" {
			env = setEnv(env, "CLAUDE_CODE_OAUTH_TOKEN", a.APIKey)
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

func DefaultConfig() Config { return defaultConfig() }

func defaultConfig() Config {
	return Config{
		Pipeline: PipelineConfig{
			WorkspacesDir: "/workspaces",
			MaxFixRounds:  3,
			TestCommand:   "flutter test",
			LintCommand:   "flutter analyze",
		},
		Github: GithubConfig{
			TriggerLabel: "ai-implement",
			BaseBranch:   "main",
		},
		Agents: map[string]AgentConfig{
			"developer": {
				CLI:          "claude",
				Args:         []string{"--print", "--dangerously-skip-permissions", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep", "--max-turns", "40"},
				MaxFixRounds: 3,
				TimeoutSecs:  1800,
				SystemPrompt: defaultDeveloperPrompt,
			},
			"tester": {
				CLI:          "claude",
				Args:         []string{"--print", "--dangerously-skip-permissions", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"},
				MaxFixRounds: 3,
				TimeoutSecs:  1200,
				SystemPrompt: defaultTesterPrompt,
			},
			"reviewer": {
				CLI:          "claude",
				Args:         []string{"--print", "--dangerously-skip-permissions", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"},
				MaxFixRounds: 3,
				TimeoutSecs:  1200,
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
	if err := os.MkdirAll(filepath.Dir(m.path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(m.path, data, 0o600)
}

// ──────────────────────────────────────────────
// Default prompts
// ──────────────────────────────────────────────

const defaultDeveloperPrompt = `You are an expert developer working on a production codebase.

Your task:
1. Read .torch_handoff.md if it exists — it contains feedback from a previous fix round.
2. Explore the codebase — understand existing patterns, architecture, naming conventions.
3. Implement the feature described in the issue. Match existing code style exactly. Minimal, focused changes — do not over-engineer.
4. Do NOT write tests. The tester agent handles that.
5. Run '{lint_command}' — fix ALL warnings and errors before continuing.
6. Run '{test_command}' — all pre-existing tests must still pass. Fix any regressions you introduced. Do not delete tests to make them pass.
7. Stage only implementation files with 'git add .' (do not stage test files you did not touch).
8. Write .torch_handoff.md (it will not be committed) with the following sections:

## What was implemented
Describe the feature: what it does, the approach taken, key decisions made.

## Files changed
List every file added or modified, with a one-line note on what changed.

## Notes for the tester
Point out the most important behaviours to test, edge cases to consider, and any tricky logic paths.

Rules:
- Do NOT commit — only stage changes.
- Do not modify dependency files unless strictly necessary.
- Do not modify or delete existing tests.`

const defaultTesterPrompt = `You are a senior QA engineer. Your job is to WRITE tests, not just run them.

Steps:
1. Read .torch_handoff.md — the developer wrote it for you. Understand what was implemented and what needs testing.
2. Run 'git diff --staged' to inspect the implementation in detail.
3. Write unit tests (and integration tests where appropriate) covering:
   - Every new function, method, or class introduced
   - The happy path for each new behaviour
   - Edge cases and boundary conditions called out in .torch_handoff.md
   - Error and failure scenarios
4. Follow existing test file structure and naming conventions exactly.
5. Stage all new/modified test files with 'git add .'.
6. Run '{lint_command}' — fix any lint issues in the test files you wrote.
7. Run '{test_command}' — all tests (old and new) must pass.
8. Update .torch_handoff.md by appending a new section:

## What the tester did
List the test files created/modified and what each covers.

## Notes for the reviewer
Highlight any areas where coverage is intentionally limited and why, or anything that deserves extra scrutiny in the review.

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "if failed: which tests are failing or missing, and why",
  "issues": ["specific issue 1", "specific issue 2"]
}

Return failed if: any test fails, you could not write meaningful tests, or critical paths are still untested.`

const defaultReviewerPrompt = `You are a senior software architect doing a code review.

Steps:
1. Read .torch_handoff.md — it summarises what the developer implemented and what the tester verified. Use it as context for your review.
2. Run 'git diff --staged' to see all staged changes (implementation + tests).
3. Review for:
   - Correctness: does the implementation fully satisfy the issue requirements?
   - Code quality: naming, clarity, duplication, dead code
   - Architecture: does it fit existing patterns? No unnecessary abstractions
   - Security: input validation, error handling, no sensitive data leaked
   - Test coverage: are the important paths tested?
4. Verify naming conventions and code style match the existing codebase.

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "required changes if failed, empty string if success",
  "comments": ["observation 1", "observation 2"]
}

Be constructive but strict. Return failed if there are correctness issues, architectural problems, security concerns, or missing requirements. Minor style nits alone are not grounds for failure.`

package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"ai-pipeline/internal/config"
	"ai-pipeline/internal/pipeline"
)

type Runner struct {
	cfg    config.AgentConfig
	role   string
	issueN int
}

func NewRunner(role string, cfg config.AgentConfig, issueN int) *Runner {
	return &Runner{cfg: cfg, role: role, issueN: issueN}
}

func (r *Runner) RunWithPrompt(ctx context.Context, workspace, prompt string) (string, error) {
	args := append(append([]string{}, r.cfg.Args...), "-p", prompt)

	cmd := exec.CommandContext(ctx, r.cfg.CLI, args...)
	cmd.Dir = workspace
	cmd.Env = r.cfg.MergedEnv()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	fmt.Printf("[%s/issue-%d] starting %s\n", r.role, r.issueN, r.cfg.CLI)

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s CLI failed: %w\nstderr: %s", r.role, err, stderr.String())
	}

	out := stdout.String()
	fmt.Printf("[%s/issue-%d] completed (%d chars)\n", r.role, r.issueN, len(out))
	return out, nil
}

// ParseJSONResult extracts status+feedback from agent output.
// Agents are instructed to respond in JSON; we scan for the first { ... } block.
func ParseJSONResult(output string) (pipeline.AgentResult, error) {
	start := strings.Index(output, "{")
	end := strings.LastIndex(output, "}")
	if start == -1 || end == -1 || end <= start {
		return pipeline.AgentResult{}, fmt.Errorf("no JSON found in output")
	}

	var result struct {
		Status   string `json:"status"`
		Feedback string `json:"feedback"`
	}
	if err := json.Unmarshal([]byte(output[start:end+1]), &result); err != nil {
		return pipeline.AgentResult{}, fmt.Errorf("parse JSON: %w", err)
	}

	status := pipeline.AgentStatus(result.Status)
	if status != pipeline.StatusSuccess && status != pipeline.StatusFailed {
		return pipeline.AgentResult{}, fmt.Errorf("unknown status: %q", result.Status)
	}

	return pipeline.AgentResult{
		Status:   status,
		Feedback: result.Feedback,
		Output:   output,
	}, nil
}

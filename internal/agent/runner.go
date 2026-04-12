package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"time"

	"ai-pipeline/internal/config"
	"ai-pipeline/internal/livelog"
	"ai-pipeline/internal/types"
)

type Runner struct {
	cfg      config.AgentConfig
	role     string
	issueN   int
	extraEnv map[string]string
}

func NewRunner(role string, cfg config.AgentConfig, issueN int, extraEnv map[string]string) *Runner {
	return &Runner{cfg: cfg, role: role, issueN: issueN, extraEnv: extraEnv}
}

const agentRetries = 3

// RunWithRetry calls RunWithPrompt up to agentRetries times on failure.
func (r *Runner) RunWithRetry(ctx context.Context, workspace, prompt string) (string, error) {
	var lastErr error
	for attempt := 1; attempt <= agentRetries; attempt++ {
		if attempt > 1 {
			slog.Warn("retrying agent", "role", r.role, "issue", r.issueN, "attempt", attempt, "err", lastErr)
			r.emit(livelog.LineInfo, fmt.Sprintf("retrying (attempt %d/%d): %v", attempt, agentRetries, lastErr))
		}
		out, err := r.RunWithPrompt(ctx, workspace, prompt)
		if err == nil {
			return out, nil
		}
		lastErr = err
	}
	return "", fmt.Errorf("agent failed after %d attempts: %w", agentRetries, lastErr)
}

const defaultTimeoutSecs = 1800

func (r *Runner) RunWithPrompt(ctx context.Context, workspace, prompt string) (string, error) {
	timeoutSecs := r.cfg.TimeoutSecs
	if timeoutSecs <= 0 {
		timeoutSecs = defaultTimeoutSecs
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSecs)*time.Second)
	defer cancel()
	var args []string
	if r.cfg.CLI == "opencode" {
		args = append(append([]string{}, r.cfg.Args...), "--format", "json", prompt)
	} else {
		args = append(append([]string{}, r.cfg.Args...), "-p", prompt)
	}

	cmd := exec.CommandContext(ctx, r.cfg.CLI, args...)
	cmd.Dir = workspace
	cmd.Env = r.cfg.MergedEnv(r.extraEnv)

	log := slog.With("role", r.role, "issue", r.issueN, "cli", r.cfg.CLI)
	log.Info("agent starting", "workspace", workspace)
	r.emit(livelog.LineInfo, fmt.Sprintf("starting %s in %s", r.cfg.CLI, workspace))

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("stdout pipe: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("start %s: %w", r.cfg.CLI, err)
	}

	var stdoutBuf bytes.Buffer
	scanner := bufio.NewScanner(io.TeeReader(stdoutPipe, &stdoutBuf))
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if r.cfg.CLI == "opencode" {
			r.handleOpencodeEvent(log, line)
		} else {
			// claude: plain text lines
			if strings.TrimSpace(line) != "" {
				log.Info(r.role+" output", "line", truncate(line, 200))
				r.emit(livelog.LineText, line)
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		stderrStr := strings.TrimSpace(stderr.String())
		if ctx.Err() == context.DeadlineExceeded {
			log.Error("agent timed out", "timeout_secs", timeoutSecs)
			r.emit(livelog.LineError, fmt.Sprintf("timed out after %ds", timeoutSecs))
			return "", fmt.Errorf("%s CLI timed out after %ds", r.role, timeoutSecs)
		}
		log.Error("agent failed", "err", err, "stderr", stderrStr)
		r.emit(livelog.LineError, fmt.Sprintf("CLI failed: %v — %s", err, stderrStr))
		return "", fmt.Errorf("%s CLI failed: %w\nstderr: %s", r.role, err, stderrStr)
	}

	raw := stdoutBuf.String()
	var out string
	if r.cfg.CLI == "opencode" {
		out = extractOpencodeText(raw)
		if out == "" {
			out = raw
		}
	} else {
		out = raw
	}

	log.Info("agent completed", "output_len", len(out))
	r.emit(livelog.LineInfo, fmt.Sprintf("completed (%d chars output)", len(out)))
	return out, nil
}

// handleOpencodeEvent parses one JSON event line and logs/stores the meaningful parts.
// opencode --format json emits events where content lives in the "part" field:
//   part.type = "text"             → assistant text output
//   part.type = "tool-invocation"  → tool call + result
// Top-level "type" is a lifecycle tag (step_start, step_finish, …).
func (r *Runner) handleOpencodeEvent(log *slog.Logger, line string) {
	var ev struct {
		Type  string          `json:"type"`
		Error *struct {
			Name string `json:"name"`
			Data struct {
				Message string `json:"message"`
			} `json:"data"`
		} `json:"error"`
		Part *struct {
			Type           string `json:"type"`
			Text           string `json:"text"`
			ToolInvocation *struct {
				ToolName string          `json:"toolName"`
				Args     json.RawMessage `json:"args"`
				State    string          `json:"state"`
				Result   string          `json:"result"`
			} `json:"toolInvocation"`
		} `json:"part"`
	}
	if err := json.Unmarshal([]byte(line), &ev); err != nil {
		return
	}

	// Top-level error event
	if ev.Type == "error" && ev.Error != nil {
		msg := ev.Error.Data.Message
		if msg == "" {
			msg = ev.Error.Name
		}
		log.Error("opencode error", "msg", msg)
		r.emit(livelog.LineError, msg)
		return
	}

	// Content is in part
	if ev.Part == nil {
		return
	}

	switch ev.Part.Type {
	case "text":
		text := strings.TrimSpace(ev.Part.Text)
		if text == "" {
			return
		}
		// Collapse multiple blank lines to a single newline
		for strings.Contains(text, "\n\n") {
			text = strings.ReplaceAll(text, "\n\n", "\n")
		}
		log.Info(r.role+" text", "text", truncate(text, 300))
		r.emit(livelog.LineText, text)

	case "tool-invocation":
		ti := ev.Part.ToolInvocation
		if ti == nil {
			return
		}
		switch ti.State {
		case "call", "partial-call":
			args := truncate(string(ti.Args), 200)
			log.Info(r.role+" tool", "tool", ti.ToolName, "args", args)
			r.emit(livelog.LineTool, ti.ToolName+": "+args)
		case "result":
			result := truncate(ti.Result, 150)
			log.Info(r.role+" result", "tool", ti.ToolName, "result", result)
			r.emit(livelog.LineResult, ti.ToolName+" → "+result)
		}
	}
}

func (r *Runner) emit(typ livelog.LineType, content string) {
	livelog.Add(r.issueN, livelog.Line{
		Time:    time.Now(),
		Role:    r.role,
		Type:    typ,
		Content: content,
	})
}

// extractOpencodeText pulls all assistant text from the event stream.
// opencode puts text content in part.type="text", part.text="..."
func extractOpencodeText(jsonStream string) string {
	var parts []string
	for _, line := range strings.Split(jsonStream, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ev struct {
			Part *struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"part"`
		}
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		if ev.Part != nil && ev.Part.Type == "text" && ev.Part.Text != "" {
			parts = append(parts, ev.Part.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// ParseJSONResult extracts status+feedback from agent output.
func ParseJSONResult(output string) (types.AgentResult, error) {
	for _, line := range strings.Split(output, "\n") {
		if r, ok := tryParseStatusJSON(line); ok {
			return types.AgentResult{Status: r.Status, Feedback: r.Feedback, Output: output}, nil
		}
	}
	if r, ok := tryParseStatusJSON(output); ok {
		return types.AgentResult{Status: r.Status, Feedback: r.Feedback, Output: output}, nil
	}
	return types.AgentResult{}, fmt.Errorf("no JSON found in output")
}

type statusJSON struct {
	Status   types.AgentStatus `json:"status"`
	Feedback string            `json:"feedback"`
}

func tryParseStatusJSON(s string) (statusJSON, bool) {
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start == -1 || end == -1 || end <= start {
		return statusJSON{}, false
	}
	var r statusJSON
	if err := json.Unmarshal([]byte(s[start:end+1]), &r); err != nil {
		return statusJSON{}, false
	}
	if r.Status != types.StatusSuccess && r.Status != types.StatusFailed {
		return statusJSON{}, false
	}
	return r, true
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

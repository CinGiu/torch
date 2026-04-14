package ws

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"torch/internal/gitclient"
	"torch/internal/store"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	// Allow all origins — the JWT provides the actual auth check.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// TerminalHandler returns an http.HandlerFunc that upgrades the connection to a
// WebSocket PTY session.
//
//   - extractSub validates a JWT and returns the account ID ("sub" claim).
//   - st is the user config store, used to load the GitHub token when cloning.
//
// If ?repo=owner/repo is present, the handler clones the repo before starting
// bash and injects GITHUB_TOKEN + create_issue into the session.
func TerminalHandler(extractSub func(string) (string, error), st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// ── Auth ──────────────────────────────────────────────────────────────
		token := r.URL.Query().Get("token")
		accountID, err := extractSub(token)
		if err != nil {
			slog.Warn("ws/terminal auth failed", "err", err, "token_len", len(token))
			http.Error(w, "unauthorized: "+err.Error(), http.StatusUnauthorized)
			return
		}

		repo := r.URL.Query().Get("repo") // optional: "owner/repo"

		// ── Upgrade ───────────────────────────────────────────────────────────
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("ws upgrade failed", "err", err)
			return
		}
		defer conn.Close()

		send := func(text string) {
			conn.WriteMessage(websocket.BinaryMessage, []byte(text))
		}

		// ── Workspace: clone if repo requested ────────────────────────────────
		workDir := "/workspaces"
		var clonedDir string // non-empty → clean up on exit

		if repo != "" {
			cfg, err := st.GetConfig(accountID)
			if err != nil {
				send("\r\n\x1b[31mError loading config: " + err.Error() + "\x1b[0m\r\n")
				return
			}

			shortID := shortToken(token)
			workspace := fmt.Sprintf("/workspaces/groom-%s", shortID)
			cloneURL := "https://github.com/" + repo + ".git"

			send(fmt.Sprintf("\r\n\x1b[33m[torch]\x1b[0m Cloning \x1b[36m%s\x1b[0m …\r\n", repo))

			gitClient := gitclient.NewClient(cfg.Github.Token)
			if err := gitClient.Clone(cloneURL, workspace); err != nil {
				send("\r\n\x1b[31mClone failed:\x1b[0m " + strings.ReplaceAll(err.Error(), "\n", "\r\n") + "\r\n")
				return
			}
			send("\x1b[32m✓ Cloned\x1b[0m — starting session…\r\n\r\n")

			// Write the create_issue Node.js script
			if err := writeCreateIssueScript(workspace, cfg.Github.Token, repo); err != nil {
				slog.Warn("could not write create_issue script", "err", err)
			}

			workDir = workspace
			clonedDir = workspace
		}

		if clonedDir != "" {
			defer os.RemoveAll(clonedDir)
		}

		// ── Write bash init file ──────────────────────────────────────────────
		initFile, err := writeInitFile(workDir, repo)
		if err != nil {
			send("\r\n\x1b[31mCould not write init file: " + err.Error() + "\x1b[0m\r\n")
			return
		}
		defer os.Remove(initFile)

		// ── Spawn bash PTY ────────────────────────────────────────────────────
		var args []string
		if initFile != "" {
			args = []string{"--init-file", initFile}
		}
		c := exec.Command("bash", args...)
		c.Env = append(os.Environ(), "TERM=xterm-256color")
		c.Dir = workDir

		ptmx, err := pty.Start(c)
		if err != nil {
			slog.Error("pty start failed", "err", err)
			send("\r\nError: could not start shell: " + err.Error() + "\r\n")
			return
		}

		var once sync.Once
		closeAll := func() {
			once.Do(func() {
				ptmx.Close()
				c.Process.Kill()
			})
		}
		defer closeAll()

		// PTY → WebSocket
		go func() {
			defer closeAll()
			buf := make([]byte, 4096)
			for {
				n, err := ptmx.Read(buf)
				if err != nil {
					return
				}
				if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
					return
				}
			}
		}()

		// WebSocket → PTY
		for {
			msgType, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			switch msgType {
			case websocket.BinaryMessage:
				ptmx.Write(msg)
			case websocket.TextMessage:
				var ctrl struct {
					Type string `json:"type"`
					Rows uint16 `json:"rows"`
					Cols uint16 `json:"cols"`
				}
				if err := json.Unmarshal(msg, &ctrl); err == nil && ctrl.Type == "resize" {
					pty.Setsize(ptmx, &pty.Winsize{Rows: ctrl.Rows, Cols: ctrl.Cols})
				}
			}
		}
	}
}

// writeInitFile writes a bash --init-file script that sets up the groom
// environment and prints a welcome banner. Returns the path to the file.
func writeInitFile(workDir, repo string) (string, error) {
	path := filepath.Join(workDir, ".torch_init.sh")

	var sb strings.Builder
	// Source system defaults so PATH etc. are still set correctly
	sb.WriteString("[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc 2>/dev/null || true\n")
	sb.WriteString("[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null || true\n")

	if repo != "" {
		// Workspace is already the repo root; add it to PATH for create_issue
		sb.WriteString(`export PATH="$PWD:$PATH"` + "\n")
		sb.WriteString(`PS1='` + "\\[\\033[33m\\][groom]\\[\\033[0m\\] \\w \\$ " + `'` + "\n")
		sb.WriteString("echo ''\n")
		sb.WriteString("echo -e '\\033[33m┌─────────────────────────────────────────┐\\033[0m'\n")
		sb.WriteString(fmt.Sprintf("echo -e '\\033[33m│\\033[0m  repo:  \\033[36m%-40s\\033[33m│\\033[0m'\n", repo))
		sb.WriteString("echo -e '\\033[33m│\\033[0m  run \\033[32mclaude\\033[0m to explore & draft the issue  \\033[33m│\\033[0m'\n")
		sb.WriteString("echo -e '\\033[33m│\\033[0m  ask claude to write \\033[32missue.json\\033[0m, then run: \\033[33m│\\033[0m'\n")
		sb.WriteString("echo -e '\\033[33m│\\033[0m    \\033[32mcreate_issue\\033[0m                          \\033[33m│\\033[0m'\n")
		sb.WriteString("echo -e '\\033[33m└─────────────────────────────────────────┘\\033[0m'\n")
		sb.WriteString("echo ''\n")
	} else {
		sb.WriteString(`PS1='` + "\\[\\033[33m\\][torch]\\[\\033[0m\\] \\w \\$ " + `'` + "\n")
		sb.WriteString("echo ''\n")
		sb.WriteString("echo -e '\\033[33m[torch terminal]\\033[0m  /workspaces contains cloned repos.'\n")
		sb.WriteString("echo ''\n")
	}

	if err := os.WriteFile(path, []byte(sb.String()), 0o755); err != nil {
		return "", err
	}
	return path, nil
}

// writeCreateIssueScript writes a Node.js executable `create_issue` into the
// workspace. It reads issue.json and POSTs to the GitHub API.
func writeCreateIssueScript(workspace, githubToken, repo string) error {
	script := fmt.Sprintf(`#!/usr/bin/env node
'use strict';
const fs = require('fs');
const https = require('https');

const file = process.argv[2] || 'issue.json';
let issue;
try {
  issue = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  process.stderr.write('Error: could not read ' + file + ': ' + e.message + '\n');
  process.stderr.write('Expected: {"title": "...", "body": "...", "labels": ["enhancement"]}\n');
  process.exit(1);
}

const token = %q;
const repo  = %q;

const payload = JSON.stringify({
  title:  issue.title  || 'Untitled issue',
  body:   issue.body   || '',
  labels: issue.labels || ['enhancement'],
});

const req = https.request({
  hostname: 'api.github.com',
  path: '/repos/' + repo + '/issues',
  method: 'POST',
  headers: {
    Authorization:   'token ' + token,
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'User-Agent':    'torch-groom/1.0',
  },
}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    try {
      const r = JSON.parse(body);
      if (r.html_url) {
        process.stdout.write('\x1b[32m✓ Issue created:\x1b[0m ' + r.html_url + '\n');
      } else {
        process.stderr.write('GitHub API error: ' + body + '\n');
        process.exit(1);
      }
    } catch (e) {
      process.stderr.write('Parse error: ' + body + '\n');
      process.exit(1);
    }
  });
});
req.on('error', e => { process.stderr.write('Request error: ' + e.message + '\n'); process.exit(1); });
req.write(payload);
req.end();
`, githubToken, repo)

	path := filepath.Join(workspace, "create_issue")
	return os.WriteFile(path, []byte(script), 0o755)
}

// shortToken returns the first 8 chars of the token for use as a workspace ID.
func shortToken(token string) string {
	if len(token) > 8 {
		return token[:8]
	}
	return token
}

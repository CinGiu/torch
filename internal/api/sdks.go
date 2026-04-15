package api

import (
	"encoding/json"
	"net/http"
	"os"
)

// SDKProfile describes a well-known SDK that can be mounted from the host.
type SDKProfile struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	PathEntries []string `json:"path_entries"` // entries to prepend to PATH when enabled
	MountHint   string   `json:"mount_hint"`   // docker-compose volumes line
	Available   bool     `json:"available"`    // true if the binary/dir exists in the container
	checkPath   string   // internal: path to stat for availability
}

// knownSDKs is the authoritative list of supported SDKs.
// Each entry is matched against a fixed container path produced by the
// recommended docker-compose volume mount.
var knownSDKs = []SDKProfile{
	{
		ID:          "flutter",
		Name:        "Flutter / Dart",
		PathEntries: []string{"/opt/flutter/bin", "/opt/flutter/bin/cache/dart-sdk/bin"},
		MountHint:   "~/flutter:/opt/flutter",
		checkPath:   "/opt/flutter/bin/flutter",
	},
	{
		ID:          "go",
		Name:        "Go",
		PathEntries: []string{"/usr/local/go/bin"},
		MountHint:   "~/go:/usr/local/go",
		checkPath:   "/usr/local/go/bin/go",
	},
	{
		ID:          "python",
		Name:        "Python (pyenv)",
		PathEntries: []string{"/root/.pyenv/shims", "/root/.pyenv/bin"},
		MountHint:   "~/.pyenv:/root/.pyenv",
		checkPath:   "/root/.pyenv/bin/pyenv",
	},
	{
		ID:          "rust",
		Name:        "Rust",
		PathEntries: []string{"/root/.cargo/bin"},
		MountHint:   "~/.cargo:/root/.cargo\n      - ~/.rustup:/root/.rustup",
		checkPath:   "/root/.cargo/bin/cargo",
	},
	{
		ID:          "ruby",
		Name:        "Ruby (rbenv)",
		PathEntries: []string{"/root/.rbenv/shims", "/root/.rbenv/bin"},
		MountHint:   "~/.rbenv:/root/.rbenv",
		checkPath:   "/root/.rbenv/bin/rbenv",
	},
	{
		ID:          "java",
		Name:        "Java (SDKMAN)",
		PathEntries: []string{"/root/.sdkman/candidates/java/current/bin"},
		MountHint:   "~/.sdkman:/root/.sdkman",
		checkPath:   "/root/.sdkman/candidates/java/current/bin/java",
	},
}

// GetSDKs returns all known SDK profiles with availability detected at runtime.
func (h *Handler) GetSDKs(w http.ResponseWriter, r *http.Request) {
	out := make([]SDKProfile, len(knownSDKs))
	for i, sdk := range knownSDKs {
		out[i] = sdk
		_, err := os.Stat(sdk.checkPath)
		out[i].Available = err == nil
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

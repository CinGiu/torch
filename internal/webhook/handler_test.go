package webhook

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"torch/internal/config"
	"torch/internal/worker"
)

// ── validateSignature ─────────────────────────────────────────────────────────

func TestValidateSignature(t *testing.T) {
	body := []byte(`{"action":"labeled"}`)
	secret := "mysecret"

	validSig := func(s string, b []byte) string {
		mac := hmac.New(sha256.New, []byte(s))
		mac.Write(b)
		return "sha256=" + hex.EncodeToString(mac.Sum(nil))
	}

	cases := []struct {
		name      string
		secret    string
		sigHeader string
		want      bool
	}{
		{
			name:      "empty secret skips validation",
			secret:    "",
			sigHeader: "sha256=invalid",
			want:      true,
		},
		{
			name:      "valid HMAC accepted",
			secret:    secret,
			sigHeader: validSig(secret, body),
			want:      true,
		},
		{
			name:      "wrong secret rejected",
			secret:    secret,
			sigHeader: validSig("wrongsecret", body),
			want:      false,
		},
		{
			name:      "tampered body rejected",
			secret:    secret,
			sigHeader: validSig(secret, []byte(`{"action":"unlabeled"}`)),
			want:      false,
		},
		{
			name:      "short header (no prefix) rejected",
			secret:    secret,
			sigHeader: "tooshort",
			want:      false,
		},
		{
			name:      "empty header rejected",
			secret:    secret,
			sigHeader: "",
			want:      false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := validateSignature(c.secret, c.sigHeader, body)
			if got != c.want {
				t.Errorf("validateSignature() = %v, want %v", got, c.want)
			}
		})
	}
}

// ── Handler.Handle ────────────────────────────────────────────────────────────

// mockStore implements configStore for tests.
type mockStore struct {
	cfg config.Config
	err error
}

func (m *mockStore) GetConfig(accountID string) (config.Config, error) {
	return m.cfg, m.err
}

// mockEnqueuer implements taskEnqueuer and records dispatched tasks.
type mockEnqueuer struct {
	tasks []worker.IssueTask
	err   error
}

func (m *mockEnqueuer) Enqueue(task worker.IssueTask) error {
	m.tasks = append(m.tasks, task)
	return m.err
}

// validPayload builds a GitHub issue-labeled event body.
func validPayload(t *testing.T, action, labelName string, issueNumber int) []byte {
	t.Helper()
	p := issuePayload{
		Action: action,
		Label:  label{Name: labelName},
		Issue:  issue{Number: issueNumber, Title: "Fix bug", Body: "Something broken"},
		Repository: repository{
			FullName: "org/repo",
			CloneURL: "https://github.com/org/repo.git",
		},
	}
	b, _ := json.Marshal(p)
	return b
}

// signedRequest builds a POST to /webhook/github/{accountID} with correct HMAC.
func signedRequest(t *testing.T, accountID, secret, event string, body []byte) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/webhook/github/"+accountID, bytes.NewReader(body))
	req.Header.Set("X-GitHub-Event", event)
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		req.Header.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}
	return req
}

func newHandler(st configStore, eq taskEnqueuer) *Handler {
	return &Handler{store: st, dispatcher: eq}
}

// activeConfig returns a pipeline-active config with the given trigger label.
func activeConfig(label string) config.Config {
	cfg := config.DefaultConfig()
	cfg.Pipeline.Active = true
	cfg.Github.TriggerLabel = label
	cfg.Github.WebhookSecret = ""
	return cfg
}

func TestHandle_MissingAccountID(t *testing.T) {
	h := newHandler(&mockStore{cfg: activeConfig("ai-implement")}, &mockEnqueuer{})

	req := httptest.NewRequest(http.MethodPost, "/webhook/github/", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestHandle_AccountIDWithSlash(t *testing.T) {
	h := newHandler(&mockStore{cfg: activeConfig("ai-implement")}, &mockEnqueuer{})

	req := httptest.NewRequest(http.MethodPost, "/webhook/github/a/b", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestHandle_InvalidSignature(t *testing.T) {
	cfg := activeConfig("ai-implement")
	cfg.Github.WebhookSecret = "secret123"
	st := &mockStore{cfg: cfg}
	h := newHandler(st, &mockEnqueuer{})

	body := validPayload(t, "labeled", "ai-implement", 1)
	req := httptest.NewRequest(http.MethodPost, "/webhook/github/acc1", bytes.NewReader(body))
	req.Header.Set("X-GitHub-Event", "issues")
	req.Header.Set("X-Hub-Signature-256", "sha256=invalidsig")
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestHandle_NonIssueEventIgnored(t *testing.T) {
	h := newHandler(&mockStore{cfg: activeConfig("ai-implement")}, &mockEnqueuer{})

	body := []byte(`{}`)
	req := signedRequest(t, "acc1", "", "push", body)
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp) //nolint
	if resp["status"] != "ignored" {
		t.Errorf("status = %q, want %q", resp["status"], "ignored")
	}
}

func TestHandle_PipelineNotActive(t *testing.T) {
	cfg := activeConfig("ai-implement")
	cfg.Pipeline.Active = false
	eq := &mockEnqueuer{}
	h := newHandler(&mockStore{cfg: cfg}, eq)

	body := validPayload(t, "labeled", "ai-implement", 5)
	req := signedRequest(t, "acc1", "", "issues", body)
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp) //nolint
	if resp["status"] != "pipeline not active" {
		t.Errorf("status = %q, want %q", resp["status"], "pipeline not active")
	}
	if len(eq.tasks) != 0 {
		t.Errorf("expected 0 enqueued tasks, got %d", len(eq.tasks))
	}
}

func TestHandle_WrongLabelIgnored(t *testing.T) {
	eq := &mockEnqueuer{}
	h := newHandler(&mockStore{cfg: activeConfig("ai-implement")}, eq)

	body := validPayload(t, "labeled", "other-label", 5)
	req := signedRequest(t, "acc1", "", "issues", body)
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if len(eq.tasks) != 0 {
		t.Errorf("expected 0 enqueued tasks, got %d", len(eq.tasks))
	}
}

func TestHandle_ActionNotLabeled(t *testing.T) {
	eq := &mockEnqueuer{}
	h := newHandler(&mockStore{cfg: activeConfig("ai-implement")}, eq)

	body := validPayload(t, "opened", "ai-implement", 5)
	req := signedRequest(t, "acc1", "", "issues", body)
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if len(eq.tasks) != 0 {
		t.Errorf("expected 0 enqueued tasks, got %d", len(eq.tasks))
	}
}

func TestHandle_Success(t *testing.T) {
	eq := &mockEnqueuer{}
	h := newHandler(&mockStore{cfg: activeConfig("ai-implement")}, eq)

	body := validPayload(t, "labeled", "ai-implement", 42)
	req := signedRequest(t, "acc-xyz", "", "issues", body)
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if len(eq.tasks) != 1 {
		t.Fatalf("expected 1 enqueued task, got %d", len(eq.tasks))
	}
	task := eq.tasks[0]
	if task.AccountID != "acc-xyz" {
		t.Errorf("AccountID = %q, want acc-xyz", task.AccountID)
	}
	if task.IssueNumber != 42 {
		t.Errorf("IssueNumber = %d, want 42", task.IssueNumber)
	}
	if task.RepoFullName != "org/repo" {
		t.Errorf("RepoFullName = %q, want org/repo", task.RepoFullName)
	}

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint
	if resp["status"] != "queued" {
		t.Errorf("response status = %q, want queued", resp["status"])
	}
}

func TestHandle_SuccessWithHMAC(t *testing.T) {
	cfg := activeConfig("ai-implement")
	cfg.Github.WebhookSecret = "topsecret"
	eq := &mockEnqueuer{}
	h := newHandler(&mockStore{cfg: cfg}, eq)

	body := validPayload(t, "labeled", "ai-implement", 7)
	req := signedRequest(t, "acc1", "topsecret", "issues", body)
	w := httptest.NewRecorder()
	h.Handle(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if len(eq.tasks) != 1 {
		t.Errorf("expected 1 enqueued task, got %d", len(eq.tasks))
	}
}

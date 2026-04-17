package agent

import (
	"testing"

	"torch/internal/types"
)

func TestTruncate(t *testing.T) {
	cases := []struct {
		in   string
		n    int
		want string
	}{
		{"hello", 10, "hello"},
		{"hello", 5, "hello"},
		{"hello!", 5, "hello…"},
		{"", 3, ""},
		{"abcdef", 0, "…"},
	}
	for _, c := range cases {
		got := truncate(c.in, c.n)
		if got != c.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}

func TestParseJSONResult(t *testing.T) {
	cases := []struct {
		name       string
		input      string
		wantStatus types.AgentStatus
		wantErr    bool
	}{
		{
			name:       "success bare JSON",
			input:      `{"status":"success","feedback":""}`,
			wantStatus: types.StatusSuccess,
		},
		{
			name:       "failed with feedback",
			input:      `{"status":"failed","feedback":"tests broken"}`,
			wantStatus: types.StatusFailed,
		},
		{
			name:       "JSON embedded in surrounding text",
			input:      "thinking...\n{\"status\":\"success\",\"feedback\":\"\"}\ndone",
			wantStatus: types.StatusSuccess,
		},
		{
			name:       "extra fields ignored",
			input:      `{"status":"success","feedback":"","comments":["lgtm"]}`,
			wantStatus: types.StatusSuccess,
		},
		{
			name:       "output preserved in result",
			input:      "prefix\n{\"status\":\"failed\",\"feedback\":\"bad\"}\nsuffix",
			wantStatus: types.StatusFailed,
		},
		{
			name:    "no JSON at all",
			input:   "plain text output",
			wantErr: true,
		},
		{
			name:    "invalid status value",
			input:   `{"status":"unknown","feedback":""}`,
			wantErr: true,
		},
		{
			name:    "empty input",
			input:   "",
			wantErr: true,
		},
		{
			name:    "malformed JSON",
			input:   `{"status":}`,
			wantErr: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseJSONResult(c.input)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (result: %+v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Status != c.wantStatus {
				t.Errorf("status = %q, want %q", got.Status, c.wantStatus)
			}
			if got.Output != c.input {
				t.Errorf("Output not preserved: got %q, want %q", got.Output, c.input)
			}
		})
	}
}

func TestExtractOpencodeText(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "empty stream",
			input: "",
			want:  "",
		},
		{
			name:  "single text event",
			input: `{"part":{"type":"text","text":"hello world"}}`,
			want:  "hello world",
		},
		{
			name: "multiple text events joined",
			input: `{"part":{"type":"text","text":"first"}}` + "\n" +
				`{"part":{"type":"text","text":"second"}}`,
			want: "first\nsecond",
		},
		{
			name: "non-text events ignored",
			input: `{"type":"step_start"}` + "\n" +
				`{"part":{"type":"tool-invocation","toolName":"bash"}}` + "\n" +
				`{"part":{"type":"text","text":"output here"}}`,
			want: "output here",
		},
		{
			name: "invalid JSON lines silently skipped",
			input: "not json\n" +
				`{"part":{"type":"text","text":"valid"}}`,
			want: "valid",
		},
		{
			name:  "empty text values skipped",
			input: `{"part":{"type":"text","text":""}}`,
			want:  "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := extractOpencodeText(c.input)
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}

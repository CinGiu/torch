package pipeline

import (
	"strings"
	"testing"
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
	}
	for _, c := range cases {
		got := truncate(c.in, c.n)
		if got != c.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}

func TestFormatFeedback(t *testing.T) {
	cases := []struct {
		name  string
		input string
		check func(t *testing.T, got string)
	}{
		{
			name:  "single line prefixed with >",
			input: "test failed",
			check: func(t *testing.T, got string) {
				if got != "> test failed" {
					t.Errorf("got %q, want %q", got, "> test failed")
				}
			},
		},
		{
			name:  "multi-line each gets > prefix",
			input: "line one\nline two\nline three",
			check: func(t *testing.T, got string) {
				lines := strings.Split(got, "\n")
				if len(lines) != 3 {
					t.Fatalf("expected 3 lines, got %d: %q", len(lines), got)
				}
				for i, l := range lines {
					if !strings.HasPrefix(l, "> ") {
						t.Errorf("line %d missing '> ' prefix: %q", i, l)
					}
				}
			},
		},
		{
			name:  "leading and trailing whitespace trimmed before prefixing",
			input: "\n\nsome feedback\n\n",
			check: func(t *testing.T, got string) {
				if !strings.HasPrefix(got, "> ") {
					t.Errorf("expected '> ' prefix, got %q", got)
				}
				if strings.HasPrefix(got, "> \n") {
					t.Errorf("should not have leading empty quoted line: %q", got)
				}
			},
		},
		{
			name:  "empty feedback",
			input: "",
			check: func(t *testing.T, got string) {
				if got != "> " {
					t.Errorf("got %q, want %q", got, "> ")
				}
			},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := formatFeedback(c.input)
			c.check(t, got)
		})
	}
}

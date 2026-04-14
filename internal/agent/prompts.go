package agent

import (
	"fmt"
	"strings"

	"torch/internal/types"
)

func applyCommands(prompt, lintCmd, testCmd string) string {
	prompt = strings.ReplaceAll(prompt, "{lint_command}", lintCmd)
	prompt = strings.ReplaceAll(prompt, "{test_command}", testCmd)
	return prompt
}

func BuildDeveloperPrompt(systemPrompt string, ctx types.IssueContext, feedback, lintCmd, testCmd string) string {
	var sb strings.Builder
	sb.WriteString(applyCommands(systemPrompt, lintCmd, testCmd))
	sb.WriteString(fmt.Sprintf("\n\n---\nIssue #%d: %s\n\n%s", ctx.IssueNumber, ctx.IssueTitle, ctx.IssueBody))

	if feedback != "" {
		sb.WriteString(fmt.Sprintf(`

---
PREVIOUS ATTEMPT FAILED — fix the following issues:

%s

Review the feedback carefully, understand the root cause, and fix it.
Then re-run '%s' and '%s' to confirm everything passes.`, feedback, lintCmd, testCmd))
	}

	return strings.TrimSpace(sb.String())
}

func BuildTesterPrompt(systemPrompt string, ctx types.IssueContext, lintCmd, testCmd string) string {
	task := fmt.Sprintf("---\nIssue #%d: %s\n\nTest the implementation of this issue.", ctx.IssueNumber, ctx.IssueTitle)
	return strings.TrimSpace(applyCommands(systemPrompt, lintCmd, testCmd) + "\n\n" + task)
}

func BuildReviewerPrompt(systemPrompt string, ctx types.IssueContext, lintCmd, testCmd string) string {
	task := fmt.Sprintf("---\nIssue #%d: %s\n\nReview the implementation of this issue.", ctx.IssueNumber, ctx.IssueTitle)
	return strings.TrimSpace(applyCommands(systemPrompt, lintCmd, testCmd) + "\n\n" + task)
}


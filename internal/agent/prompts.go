package agent

import (
	"fmt"
	"strings"

	"ai-pipeline/internal/pipeline"
)

func BuildDeveloperPrompt(systemPrompt string, ctx pipeline.IssueContext, feedback string) string {
	var sb strings.Builder
	sb.WriteString(systemPrompt)
	sb.WriteString(fmt.Sprintf("\n\n---\nIssue #%d: %s\n\n%s", ctx.IssueNumber, ctx.IssueTitle, ctx.IssueBody))

	if feedback != "" {
		sb.WriteString(fmt.Sprintf(`

---
PREVIOUS ATTEMPT FAILED — fix the following issues:

%s

Review the feedback carefully, understand the root cause, and fix it.
Then re-run 'flutter analyze' and 'flutter test' to confirm everything passes.`, feedback))
	}

	return strings.TrimSpace(sb.String())
}

func BuildTesterPrompt(systemPrompt string, ctx pipeline.IssueContext) string {
	header := fmt.Sprintf("You are reviewing issue #%d: \"%s\"\n\n", ctx.IssueNumber, ctx.IssueTitle)
	return strings.TrimSpace(header + systemPrompt)
}

func BuildReviewerPrompt(systemPrompt string, ctx pipeline.IssueContext) string {
	header := fmt.Sprintf("You are reviewing issue #%d: \"%s\"\n\n", ctx.IssueNumber, ctx.IssueTitle)
	return strings.TrimSpace(header + systemPrompt)
}

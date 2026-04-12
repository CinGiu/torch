package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"ai-pipeline/internal/agent"
	"ai-pipeline/internal/config"
	"ai-pipeline/internal/githubclient"
)

type Orchestrator struct {
	cfgMgr *config.Manager
	status *githubclient.StatusManager
}

func NewOrchestrator(cfgMgr *config.Manager, status *githubclient.StatusManager) *Orchestrator {
	return &Orchestrator{cfgMgr: cfgMgr, status: status}
}

func (o *Orchestrator) Run(ctx context.Context, issueCtx IssueContext) error {
	cfg := o.cfgMgr.Get()
	log := slog.With("issue", issueCtx.IssueNumber)

	sm := func(to githubclient.PipelineLabel, comment string) {
		o.status.Transition(ctx, issueCtx.IssueNumber, to, comment)
	}

	extraEnv := cfg.Pipeline.ExtraEnv
	devRunner := agent.NewRunner("developer", cfg.Agents["developer"], issueCtx.IssueNumber, extraEnv)
	testRunner := agent.NewRunner("tester", cfg.Agents["tester"], issueCtx.IssueNumber, extraEnv)
	revRunner := agent.NewRunner("reviewer", cfg.Agents["reviewer"], issueCtx.IssueNumber, extraEnv)

	sm(githubclient.LabelInProgress, "🤖 **AI pipeline started** — developer agent is implementing the feature.")

	lintCmd := cfg.Pipeline.LintCommand
	testCmd := cfg.Pipeline.TestCommand

	var feedback string
	maxRounds := cfg.Pipeline.MaxFixRounds

	for round := 0; round <= maxRounds; round++ {
		if round == maxRounds {
			sm(githubclient.LabelFailed, fmt.Sprintf(
				"❌ **Pipeline failed** — max fix rounds (%d) reached.\n\nLast feedback:\n%s",
				maxRounds, formatFeedback(feedback),
			))
			return fmt.Errorf("max fix rounds (%d) reached", maxRounds)
		}

		// ── DEVELOPER ────────────────────────────────
		if round > 0 {
			sm(githubclient.LabelNeedsFix, fmt.Sprintf(
				"🔨 **Developer fixing (round %d/%d)**\n\nFeedback:\n%s",
				round, maxRounds, formatFeedback(feedback),
			))
		}
		log.Info("developer", "round", round)

		devPrompt := agent.BuildDeveloperPrompt(cfg.Agents["developer"].SystemPrompt, issueCtx, feedback, lintCmd, testCmd)
		if _, err := devRunner.RunWithRetry(ctx, issueCtx.Workspace, devPrompt); err != nil {
			log.Error("developer agent error", "round", round, "err", err)
			sm(githubclient.LabelFailed, fmt.Sprintf("❌ **Developer agent error**\n```\n%s\n```", err))
			return fmt.Errorf("developer (round %d): %w", round, err)
		}

		// ── TESTER ───────────────────────────────────
		sm(githubclient.LabelTesting, fmt.Sprintf("🧪 **Tester agent running** — executing `%s` and checking coverage...", testCmd))
		log.Info("tester", "round", round)

		testPrompt := agent.BuildTesterPrompt(cfg.Agents["tester"].SystemPrompt, issueCtx, lintCmd, testCmd)
		testOutput, err := testRunner.RunWithRetry(ctx, issueCtx.Workspace, testPrompt)
		if err != nil {
			log.Error("tester agent error", "round", round, "err", err)
			sm(githubclient.LabelFailed, fmt.Sprintf("❌ **Tester agent error**\n```\n%s\n```", err))
			return fmt.Errorf("tester (round %d): %w", round, err)
		}

		testResult, err := agent.ParseJSONResult(testOutput)
		if err != nil {
			log.Warn("tester: cannot parse result", "err", err, "output_preview", truncate(testOutput, 200))
			feedback = fmt.Sprintf("[TESTER — unparsed output]\n%s", testOutput)
			continue
		}

		if testResult.Status == StatusFailed {
			log.Warn("tester: failed", "round", round, "feedback", testResult.Feedback)
			feedback = fmt.Sprintf("[TESTER FEEDBACK]\n%s", testResult.Feedback)
			continue
		}
		log.Info("tester: passed")

		// ── REVIEWER ─────────────────────────────────
		sm(githubclient.LabelReviewing, "🔍 **Reviewer agent running** — checking code quality and architecture...")
		log.Info("reviewer", "round", round)

		revPrompt := agent.BuildReviewerPrompt(cfg.Agents["reviewer"].SystemPrompt, issueCtx, lintCmd, testCmd)
		revOutput, err := revRunner.RunWithRetry(ctx, issueCtx.Workspace, revPrompt)
		if err != nil {
			log.Error("reviewer agent error", "round", round, "err", err)
			sm(githubclient.LabelFailed, fmt.Sprintf("❌ **Reviewer agent error**\n```\n%s\n```", err))
			return fmt.Errorf("reviewer (round %d): %w", round, err)
		}

		revResult, err := agent.ParseJSONResult(revOutput)
		if err != nil {
			log.Warn("reviewer: cannot parse result", "err", err, "output_preview", truncate(revOutput, 200))
			feedback = fmt.Sprintf("[REVIEWER — unparsed output]\n%s", revOutput)
			continue
		}

		if revResult.Status == StatusFailed {
			log.Warn("reviewer: failed", "round", round, "feedback", revResult.Feedback)
			feedback = fmt.Sprintf("[REVIEWER FEEDBACK]\n%s", revResult.Feedback)
			continue
		}

		sm(githubclient.LabelApproved, "✅ **All checks passed** — tester and reviewer approved. Opening PR...")
		log.Info("pipeline: all agents approved")
		return nil
	}

	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func formatFeedback(feedback string) string {
	lines := strings.Split(strings.TrimSpace(feedback), "\n")
	for i, l := range lines {
		lines[i] = "> " + l
	}
	return strings.Join(lines, "\n")
}

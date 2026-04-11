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

	devRunner := agent.NewRunner("developer", cfg.Agents["developer"], issueCtx.IssueNumber)
	testRunner := agent.NewRunner("tester", cfg.Agents["tester"], issueCtx.IssueNumber)
	revRunner := agent.NewRunner("reviewer", cfg.Agents["reviewer"], issueCtx.IssueNumber)

	sm(githubclient.LabelInProgress, "🤖 **AI pipeline started** — developer agent is implementing the feature.")

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

		devPrompt := agent.BuildDeveloperPrompt(cfg.Agents["developer"].SystemPrompt, issueCtx, feedback)
		if _, err := devRunner.RunWithPrompt(ctx, issueCtx.Workspace, devPrompt); err != nil {
			sm(githubclient.LabelFailed, fmt.Sprintf("❌ **Developer agent error**\n```\n%s\n```", err))
			return fmt.Errorf("developer (round %d): %w", round, err)
		}

		// ── TESTER ───────────────────────────────────
		sm(githubclient.LabelTesting, "🧪 **Tester agent running** — executing flutter test and checking coverage...")
		log.Info("tester", "round", round)

		testPrompt := agent.BuildTesterPrompt(cfg.Agents["tester"].SystemPrompt, issueCtx)
		testOutput, err := testRunner.RunWithPrompt(ctx, issueCtx.Workspace, testPrompt)
		if err != nil {
			sm(githubclient.LabelFailed, fmt.Sprintf("❌ **Tester agent error**\n```\n%s\n```", err))
			return fmt.Errorf("tester (round %d): %w", round, err)
		}

		testResult, err := agent.ParseJSONResult(testOutput)
		if err != nil {
			log.Warn("tester: cannot parse result", "err", err)
			feedback = fmt.Sprintf("[TESTER — unparsed output]\n%s", testOutput)
			continue
		}

		if testResult.Status == StatusFailed {
			log.Warn("tester: failed", "feedback", testResult.Feedback)
			feedback = fmt.Sprintf("[TESTER FEEDBACK]\n%s", testResult.Feedback)
			continue
		}
		log.Info("tester: passed")

		// ── REVIEWER ─────────────────────────────────
		sm(githubclient.LabelReviewing, "🔍 **Reviewer agent running** — checking code quality and architecture...")
		log.Info("reviewer", "round", round)

		revPrompt := agent.BuildReviewerPrompt(cfg.Agents["reviewer"].SystemPrompt, issueCtx)
		revOutput, err := revRunner.RunWithPrompt(ctx, issueCtx.Workspace, revPrompt)
		if err != nil {
			sm(githubclient.LabelFailed, fmt.Sprintf("❌ **Reviewer agent error**\n```\n%s\n```", err))
			return fmt.Errorf("reviewer (round %d): %w", round, err)
		}

		revResult, err := agent.ParseJSONResult(revOutput)
		if err != nil {
			log.Warn("reviewer: cannot parse result", "err", err)
			feedback = fmt.Sprintf("[REVIEWER — unparsed output]\n%s", revOutput)
			continue
		}

		if revResult.Status == StatusFailed {
			log.Warn("reviewer: failed", "feedback", revResult.Feedback)
			feedback = fmt.Sprintf("[REVIEWER FEEDBACK]\n%s", revResult.Feedback)
			continue
		}

		sm(githubclient.LabelApproved, "✅ **All checks passed** — tester and reviewer approved. Opening PR...")
		log.Info("pipeline: all agents approved")
		return nil
	}

	return nil
}

func formatFeedback(feedback string) string {
	lines := strings.Split(strings.TrimSpace(feedback), "\n")
	for i, l := range lines {
		lines[i] = "> " + l
	}
	return strings.Join(lines, "\n")
}

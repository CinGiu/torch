package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"ai-pipeline/internal/config"
	"ai-pipeline/internal/gitclient"
	"ai-pipeline/internal/githubclient"
	"ai-pipeline/internal/pipeline"

	"github.com/hibiken/asynq"
)

type Processor struct {
	cfgMgr *config.Manager
}

func NewProcessor(cfgMgr *config.Manager) *Processor {
	return &Processor{cfgMgr: cfgMgr}
}

func (p *Processor) ProcessIssueTask(ctx context.Context, t *asynq.Task) error {
	var task IssueTask
	if err := json.Unmarshal(t.Payload(), &task); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}

	cfg := p.cfgMgr.Get()
	log := slog.With("issue", task.IssueNumber, "repo", task.RepoFullName)
	log.Info("pipeline started")

	workspace := fmt.Sprintf("%s/issue-%d", cfg.Pipeline.WorkspacesDir, task.IssueNumber)
	branchName := fmt.Sprintf("feat/issue-%d-ai", task.IssueNumber)

	gitClient := gitclient.NewClient(cfg.Github.Token)
	ghClient := githubclient.NewClient(cfg.Github.Token)

	owner, repo, err := splitRepo(task.RepoFullName)
	if err != nil {
		return err
	}
	sm := githubclient.NewStatusManager(ghClient, owner, repo)

	defer func() {
		if err := gitClient.Cleanup(workspace); err != nil {
			log.Error("cleanup failed", "err", err)
		}
	}()

	// Ensure pipeline labels exist on the repo
	if err := sm.EnsureLabelsExist(ctx); err != nil {
		log.Warn("cannot ensure labels", "err", err)
	}

	// Clone
	log.Info("cloning")
	if err := gitClient.Clone(task.CloneURL, workspace); err != nil {
		sm.Transition(ctx, task.IssueNumber, githubclient.LabelFailed,
			fmt.Sprintf("❌ **Clone failed**\n```\n%s\n```", err))
		return fmt.Errorf("clone: %w", err)
	}

	// Branch
	if err := gitClient.CreateBranch(workspace, branchName); err != nil {
		return fmt.Errorf("branch: %w", err)
	}

	// Run multi-agent pipeline
	orch := pipeline.NewOrchestrator(p.cfgMgr, sm)
	issueCtx := pipeline.IssueContext{
		IssueNumber:  task.IssueNumber,
		IssueTitle:   task.IssueTitle,
		IssueBody:    task.IssueBody,
		RepoFullName: task.RepoFullName,
		Workspace:    workspace,
		BranchName:   branchName,
	}

	if err := orch.Run(ctx, issueCtx); err != nil {
		return fmt.Errorf("orchestrator: %w", err)
	}

	// Commit + push
	commitMsg := fmt.Sprintf("feat: implement issue #%d\n\n%s", task.IssueNumber, task.IssueTitle)
	if err := gitClient.CommitAndPush(workspace, branchName, commitMsg); err != nil {
		sm.Transition(ctx, task.IssueNumber, githubclient.LabelFailed,
			fmt.Sprintf("❌ **Push failed**\n```\n%s\n```", err))
		return fmt.Errorf("push: %w", err)
	}

	// Open PR
	prURL, err := ghClient.OpenPR(ctx, githubclient.PRRequest{
		RepoFullName: task.RepoFullName,
		Title:        fmt.Sprintf("[AI] %s", task.IssueTitle),
		Body:         fmt.Sprintf("Closes #%d\n\n🤖 Implemented by AI pipeline.", task.IssueNumber),
		Head:         branchName,
		Base:         cfg.Github.BaseBranch,
		IssueNumber:  task.IssueNumber,
	})
	if err != nil {
		return fmt.Errorf("open PR: %w", err)
	}

	sm.Transition(ctx, task.IssueNumber, githubclient.LabelDone,
		fmt.Sprintf("🚀 **PR ready for your review:** %s\n\nAll automated checks passed ✅", prURL))

	log.Info("pipeline complete", "pr", prURL)
	return nil
}

func splitRepo(fullName string) (string, string, error) {
	parts := strings.SplitN(fullName, "/", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid repo name: %s", fullName)
	}
	return parts[0], parts[1], nil
}

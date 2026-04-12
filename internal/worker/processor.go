package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
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

	keepWorkspace := os.Getenv("KEEP_WORKSPACE") == "true"
	defer func() {
		if keepWorkspace {
			log.Info("workspace kept for inspection", "path", workspace)
			return
		}
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

	// Inject workspace config files (opencode permissions, etc.)
	if err := setupWorkspace(workspace, cfg.Pipeline.OpencodeConfig); err != nil {
		log.Warn("workspace setup failed", "err", err)
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

// setupWorkspace injects tool config files into the workspace before agents run.
// Files are excluded from git tracking via .git/info/exclude so they are never committed.
func setupWorkspace(workspace string, opencodeCfgTemplate string) error {
	// Build opencode.json: start from user-provided template or empty object,
	// then ensure permission.* = allow is set.
	opencodeCfg, err := mergeOpencodePermission(opencodeCfgTemplate)
	if err != nil {
		return fmt.Errorf("merge opencode config: %w", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "opencode.json"), []byte(opencodeCfg), 0o644); err != nil {
		return fmt.Errorf("write opencode.json: %w", err)
	}

	// Exclude injected files from git without touching the repo's .gitignore
	excludePath := filepath.Join(workspace, ".git", "info", "exclude")
	f, err := os.OpenFile(excludePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open .git/info/exclude: %w", err)
	}
	defer f.Close()

	_, err = f.WriteString("\n# injected by ai-pipeline\nopencode.json\n")
	return err
}

// mergeOpencodePermission takes the user's opencode.json template (may be empty)
// and ensures permission["*"] = "allow" is set, returning the merged JSON.
func mergeOpencodePermission(template string) (string, error) {
	base := map[string]interface{}{}
	if template != "" {
		if err := json.Unmarshal([]byte(template), &base); err != nil {
			return "", fmt.Errorf("invalid opencode_config JSON: %w", err)
		}
	}
	// Ensure permission map exists and has * = allow
	perm, _ := base["permission"].(map[string]interface{})
	if perm == nil {
		perm = map[string]interface{}{}
	}
	perm["*"] = "allow"
	base["permission"] = perm

	out, err := json.MarshalIndent(base, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}

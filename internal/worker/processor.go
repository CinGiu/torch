package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"torch/internal/gitclient"
	"torch/internal/githubclient"
	"torch/internal/pipeline"
	"torch/internal/store"

	"github.com/hibiken/asynq"
)

type Processor struct {
	store         *store.Store
	workspacesDir string
}

func NewProcessor(st *store.Store, workspacesDir string) *Processor {
	return &Processor{store: st, workspacesDir: workspacesDir}
}

func (p *Processor) ProcessIssueTask(ctx context.Context, t *asynq.Task) error {
	var task IssueTask
	if err := json.Unmarshal(t.Payload(), &task); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}

	cfg, err := p.store.GetConfig(task.AccountID)
	if err != nil {
		return fmt.Errorf("get config for account %s: %w", task.AccountID, err)
	}

	log := slog.With("account", task.AccountID[:8], "issue", task.IssueNumber, "repo", task.RepoFullName)
	log.Info("pipeline started")

	// Include first 8 chars of account_id to avoid collisions across users
	workspace := fmt.Sprintf("%s/issue-%s-%d", p.workspacesDir, task.AccountID[:8], task.IssueNumber)
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

	if err := sm.EnsureLabelsExist(ctx); err != nil {
		log.Warn("cannot ensure labels", "err", err)
	}

	log.Info("cloning")
	if err := gitClient.Clone(task.CloneURL, workspace); err != nil {
		sm.Transition(ctx, task.IssueNumber, githubclient.LabelFailed,
			fmt.Sprintf("❌ **Clone failed**\n```\n%s\n```", err))
		return fmt.Errorf("clone: %w", err)
	}

	if err := gitClient.CreateBranch(workspace, branchName); err != nil {
		return fmt.Errorf("branch: %w", err)
	}

	if err := setupWorkspace(workspace, cfg.Pipeline.OpencodeConfig); err != nil {
		log.Warn("workspace setup failed", "err", err)
	}

	orch := pipeline.NewOrchestrator(cfg, sm)
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

	commitMsg := fmt.Sprintf("feat: implement issue #%d\n\n%s", task.IssueNumber, task.IssueTitle)
	if err := gitClient.CommitAndPush(workspace, branchName, commitMsg); err != nil {
		sm.Transition(ctx, task.IssueNumber, githubclient.LabelFailed,
			fmt.Sprintf("❌ **Push failed**\n```\n%s\n```", err))
		return fmt.Errorf("push: %w", err)
	}

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

func setupWorkspace(workspace string, opencodeCfgTemplate string) error {
	opencodeCfg, err := mergeOpencodePermission(opencodeCfgTemplate)
	if err != nil {
		return fmt.Errorf("merge opencode config: %w", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "opencode.json"), []byte(opencodeCfg), 0o644); err != nil {
		return fmt.Errorf("write opencode.json: %w", err)
	}

	excludePath := filepath.Join(workspace, ".git", "info", "exclude")
	f, err := os.OpenFile(excludePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open .git/info/exclude: %w", err)
	}
	defer f.Close()
	_, err = f.WriteString("\n# injected by torch\nopencode.json\n.torch_handoff.md\n")
	return err
}

func mergeOpencodePermission(template string) (string, error) {
	base := map[string]interface{}{}
	if template != "" {
		if err := json.Unmarshal([]byte(template), &base); err != nil {
			return "", fmt.Errorf("invalid opencode_config JSON: %w", err)
		}
	}
	stripFileRefs(base)
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

func stripFileRefs(m map[string]interface{}) {
	for k, v := range m {
		switch val := v.(type) {
		case string:
			if strings.Contains(val, "{file:") {
				slog.Warn("stripping {file:...} reference from opencode config", "key", k)
				delete(m, k)
			}
		case map[string]interface{}:
			stripFileRefs(val)
		}
	}
}

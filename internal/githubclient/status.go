package githubclient

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/go-github/v60/github"
)

type PipelineLabel string

const (
	LabelInProgress PipelineLabel = "ai: in-progress"
	LabelTesting    PipelineLabel = "ai: testing"
	LabelReviewing  PipelineLabel = "ai: reviewing"
	LabelNeedsFix   PipelineLabel = "ai: needs-fix"
	LabelApproved   PipelineLabel = "ai: approved"
	LabelFailed     PipelineLabel = "ai: failed"
	LabelDone       PipelineLabel = "ai: done"
)

var labelColors = map[PipelineLabel]string{
	LabelInProgress: "0075ca",
	LabelTesting:    "e4e669",
	LabelReviewing:  "d93f0b",
	LabelNeedsFix:   "e11d48",
	LabelApproved:   "0e8a16",
	LabelFailed:     "b60205",
	LabelDone:       "6f42c1",
}

type StatusManager struct {
	gh    *github.Client
	owner string
	repo  string
}

func NewStatusManager(client *Client, owner, repo string) *StatusManager {
	return &StatusManager{gh: client.gh, owner: owner, repo: repo}
}

func (s *StatusManager) EnsureLabelsExist(ctx context.Context) error {
	existing, _, err := s.gh.Issues.ListLabels(ctx, s.owner, s.repo, nil)
	if err != nil {
		return fmt.Errorf("list labels: %w", err)
	}

	existingMap := make(map[string]bool)
	for _, l := range existing {
		existingMap[l.GetName()] = true
	}

	for label, color := range labelColors {
		if existingMap[string(label)] {
			continue
		}
		_, _, err := s.gh.Issues.CreateLabel(ctx, s.owner, s.repo, &github.Label{
			Name:  github.String(string(label)),
			Color: github.String(color),
		})
		if err != nil {
			slog.Warn("cannot create label", "label", label, "err", err)
		}
	}
	return nil
}

func (s *StatusManager) Transition(ctx context.Context, issueNumber int, to PipelineLabel, comment string) {
	// Remove existing pipeline labels
	current, _, err := s.gh.Issues.ListIssueLabels(ctx, s.owner, s.repo, issueNumber, nil)
	if err == nil {
		for _, l := range current {
			if strings.HasPrefix(l.GetName(), "ai:") {
				_, _ = s.gh.Issues.RemoveLabelForIssue(ctx, s.owner, s.repo, issueNumber, l.GetName())
			}
		}
	}

	// Add new label
	_, _, _ = s.gh.Issues.AddLabelsToIssue(ctx, s.owner, s.repo, issueNumber, []string{string(to)})

	// Post comment
	if comment != "" {
		_, _, _ = s.gh.Issues.CreateComment(ctx, s.owner, s.repo, issueNumber, &github.IssueComment{
			Body: github.String(comment),
		})
	}
}

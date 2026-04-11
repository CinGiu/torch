package githubclient

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/go-github/v60/github"
	"golang.org/x/oauth2"
)

type Client struct {
	gh *github.Client
}

func NewClient(token string) *Client {
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
	return &Client{
		gh: github.NewClient(oauth2.NewClient(context.Background(), ts)),
	}
}

type PRRequest struct {
	RepoFullName string
	Title        string
	Body         string
	Head         string
	Base         string
	IssueNumber  int
}

func (c *Client) OpenPR(ctx context.Context, req PRRequest) (string, error) {
	owner, repo, err := splitRepo(req.RepoFullName)
	if err != nil {
		return "", err
	}

	pr, _, err := c.gh.PullRequests.Create(ctx, owner, repo, &github.NewPullRequest{
		Title: github.String(req.Title),
		Body:  github.String(req.Body),
		Head:  github.String(req.Head),
		Base:  github.String(req.Base),
	})
	if err != nil {
		return "", fmt.Errorf("create PR: %w", err)
	}

	_, _, _ = c.gh.Issues.CreateComment(ctx, owner, repo, req.IssueNumber, &github.IssueComment{
		Body: github.String(fmt.Sprintf("🤖 PR aperta: %s", pr.GetHTMLURL())),
	})

	return pr.GetHTMLURL(), nil
}

func splitRepo(fullName string) (string, string, error) {
	parts := strings.SplitN(fullName, "/", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid repo: %s", fullName)
	}
	return parts[0], parts[1], nil
}

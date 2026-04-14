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

// ── Issues ────────────────────────────────────────────────────────────────────

type IssueItem struct {
	Number int      `json:"number"`
	Title  string   `json:"title"`
	Body   string   `json:"body"`
	Labels []string `json:"labels"`
	URL    string   `json:"url"`
}

// ListUserRepos returns the full names ("owner/repo") of all repos the token
// has access to, sorted by most recently updated (up to 300 repos).
func (c *Client) ListUserRepos(ctx context.Context) ([]string, error) {
	opts := &github.RepositoryListByAuthenticatedUserOptions{
		Sort:        "updated",
		ListOptions: github.ListOptions{PerPage: 100},
	}
	var names []string
	for {
		repos, resp, err := c.gh.Repositories.ListByAuthenticatedUser(ctx, opts)
		if err != nil {
			return nil, fmt.Errorf("list repos: %w", err)
		}
		for _, r := range repos {
			names = append(names, r.GetFullName())
		}
		if resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}
	return names, nil
}

func (c *Client) ListIssues(ctx context.Context, fullName string) ([]IssueItem, error) {
	owner, repo, err := splitRepo(fullName)
	if err != nil {
		return nil, err
	}
	issues, _, err := c.gh.Issues.ListByRepo(ctx, owner, repo, &github.IssueListByRepoOptions{
		State:       "open",
		ListOptions: github.ListOptions{PerPage: 100},
	})
	if err != nil {
		return nil, fmt.Errorf("list issues: %w", err)
	}

	var result []IssueItem
	for _, issue := range issues {
		if issue.IsPullRequest() {
			continue
		}
		labels := make([]string, 0, len(issue.Labels))
		for _, l := range issue.Labels {
			labels = append(labels, l.GetName())
		}
		result = append(result, IssueItem{
			Number: issue.GetNumber(),
			Title:  issue.GetTitle(),
			Body:   issue.GetBody(),
			Labels: labels,
			URL:    issue.GetHTMLURL(),
		})
	}
	return result, nil
}

// ── PRs ───────────────────────────────────────────────────────────────────────

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

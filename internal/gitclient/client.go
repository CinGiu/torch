package gitclient

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type Client struct {
	ghToken string
}

func NewClient(ghToken string) *Client {
	return &Client{ghToken: ghToken}
}

func (c *Client) Clone(cloneURL, dest string) error {
	// Remove stale workspace if present (e.g. left by KEEP_WORKSPACE=true).
	if err := os.RemoveAll(dest); err != nil {
		return fmt.Errorf("cleanup before clone: %w", err)
	}
	authedURL := strings.Replace(
		cloneURL,
		"https://",
		fmt.Sprintf("https://%s@", c.ghToken),
		1,
	)
	return c.run(".", "git", "clone", authedURL, dest)
}

func (c *Client) CreateBranch(workspace, branch string) error {
	return c.run(workspace, "git", "checkout", "-b", branch)
}

func (c *Client) Push(workspace, branch string) error {
	// Agent has already committed, just push the branch
	return c.run(workspace, "git", "push", "-u", "origin", branch)
}

func (c *Client) Cleanup(workspace string) error {
	return os.RemoveAll(workspace)
}

func (c *Client) run(dir string, args ...string) error {
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Torch",
		"GIT_AUTHOR_EMAIL=torch@bot.local",
		"GIT_COMMITTER_NAME=Torch",
		"GIT_COMMITTER_EMAIL=torch@bot.local",
		"GIT_CONFIG_NOSYSTEM=1",
		"HOME=/tmp",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %v: %w\n%s", args[1:], err, string(out))
	}
	return nil
}

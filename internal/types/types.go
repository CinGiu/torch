package types

type AgentStatus string

const (
	StatusSuccess AgentStatus = "success"
	StatusFailed  AgentStatus = "failed"
)

type AgentResult struct {
	Status   AgentStatus
	Feedback string
	Output   string
}

type IssueContext struct {
	IssueNumber  int
	IssueTitle   string
	IssueBody    string
	RepoFullName string
	Workspace    string
	BranchName   string
}

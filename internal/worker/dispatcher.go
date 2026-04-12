package worker

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

const TaskTypeIssue = "issue:process"

type IssueTask struct {
	IssueNumber  int    `json:"issue_number"`
	IssueTitle   string `json:"issue_title"`
	IssueBody    string `json:"issue_body"`
	RepoFullName string `json:"repo_full_name"`
	CloneURL     string `json:"clone_url"`
}

type Dispatcher struct {
	client *asynq.Client
}

func NewDispatcher(redisAddr string) *Dispatcher {
	return &Dispatcher{
		client: asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr}),
	}
}

func (d *Dispatcher) Enqueue(task IssueTask) error {
	payload, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("marshal task: %w", err)
	}
	_, err = d.client.Enqueue(
		asynq.NewTask(TaskTypeIssue, payload),
		asynq.Retention(2*time.Hour),
	)
	return err
}

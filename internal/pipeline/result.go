package pipeline

import "ai-pipeline/internal/types"

// Re-export types from common package for backward compatibility
type AgentStatus = types.AgentStatus
type AgentResult = types.AgentResult
type IssueContext = types.IssueContext

const (
	StatusSuccess = types.StatusSuccess
	StatusFailed  = types.StatusFailed
)

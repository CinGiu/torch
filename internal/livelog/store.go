package livelog

import (
	"sync"
	"time"
)

type LineType string

const (
	LineText   LineType = "text"
	LineTool   LineType = "tool"
	LineResult LineType = "result"
	LineInfo   LineType = "info"
	LineError  LineType = "error"
)

type Line struct {
	Time    time.Time `json:"time"`
	Role    string    `json:"role"`
	Type    LineType  `json:"type"`
	Content string    `json:"content"`
}

var global = &Store{logs: map[int][]Line{}}

type Store struct {
	mu   sync.RWMutex
	logs map[int][]Line
}

const maxLines = 500

func Add(issueNum int, line Line) {
	global.mu.Lock()
	defer global.mu.Unlock()
	lines := global.logs[issueNum]
	if len(lines) >= maxLines {
		lines = lines[len(lines)-maxLines+1:]
	}
	global.logs[issueNum] = append(lines, line)
}

// AddOrUpdate appends the line, but if the last entry has the same role+type
// it replaces it instead — used for incremental text streaming.
func AddOrUpdate(issueNum int, line Line) {
	global.mu.Lock()
	defer global.mu.Unlock()
	lines := global.logs[issueNum]
	if len(lines) > 0 {
		last := &lines[len(lines)-1]
		if last.Role == line.Role && last.Type == line.Type {
			last.Content = line.Content
			last.Time = line.Time
			global.logs[issueNum] = lines
			return
		}
	}
	if len(lines) >= maxLines {
		lines = lines[len(lines)-maxLines+1:]
	}
	global.logs[issueNum] = append(lines, line)
}

func Get(issueNum int) []Line {
	global.mu.RLock()
	defer global.mu.RUnlock()
	return append([]Line{}, global.logs[issueNum]...)
}

func Clear(issueNum int) {
	global.mu.Lock()
	defer global.mu.Unlock()
	delete(global.logs, issueNum)
}

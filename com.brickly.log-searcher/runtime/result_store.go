package main

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	storeResultMode       = "store"
	defaultPeekLimit      = 100
	maxPeekLimit          = 1000
	maxStoredLinesPerFile = 50000
	searchStatusQueued    = "queued"
	searchStatusSearching = "searching"
	searchStatusSuccess   = "success"
	searchStatusError     = "error"
	searchStatusCancelled = "cancelled"
	searchStatusDone      = "done"
	fallbackResultsScope  = "__fallback__"
)

type StoredGrepLine struct {
	Index     int     `json:"index"`
	Text      string  `json:"text"`
	Matches   [][]int `json:"matches"`
	File      string  `json:"file,omitempty"`
	IsContext bool    `json:"isContext,omitempty"`
	Error     string  `json:"error,omitempty"`
}

type SearchFileState struct {
	TabID      string `json:"tabId"`
	Total      int    `json:"total"`
	Status     string `json:"status"`
	Message    string `json:"message,omitempty"`
	DurationMs int64  `json:"durationMs"`
	Truncated  bool   `json:"truncated"`
	Active     bool   `json:"active"`
}

type SearchStatePayload struct {
	ServerID   string            `json:"serverId"`
	RunID      string            `json:"runId"`
	TabID      string            `json:"tabId,omitempty"`
	Tabs       []string          `json:"tabs,omitempty"`
	Files      []SearchFileState `json:"files,omitempty"`
	Status     string            `json:"status"`
	Message    string            `json:"message,omitempty"`
	Total      int               `json:"total"`
	DurationMs int64             `json:"durationMs"`
	Truncated  bool              `json:"truncated"`
	Active     bool              `json:"active"`
}

type SearchPeekResult struct {
	RunID      string           `json:"runId"`
	TabID      string           `json:"tabId"`
	Total      int              `json:"total"`
	Offset     int              `json:"offset"`
	Lines      []StoredGrepLine `json:"lines"`
	Status     string           `json:"status"`
	Message    string           `json:"message,omitempty"`
	DurationMs int64            `json:"durationMs"`
	Truncated  bool             `json:"truncated"`
}

type SearchFindResult struct {
	RunID      string `json:"runId"`
	TabID      string `json:"tabId"`
	Keyword    string `json:"keyword"`
	Total      int    `json:"total"`
	Ordinal    int    `json:"ordinal"`
	LineIndex  int    `json:"lineIndex"`
	Start      int    `json:"start"`
	End        int    `json:"end"`
	Status     string `json:"status"`
	Message    string `json:"message,omitempty"`
	DurationMs int64  `json:"durationMs"`
	Truncated  bool   `json:"truncated"`
}

type resultStore struct {
	mu      sync.Mutex
	nextRun int64
	servers map[string]*serverSearchStore
}

type serverSearchStore struct {
	RunID     string
	Files     map[string]*fileResultStore
	TabOrder  []string
	StartTime time.Time
	Status    string
	Message   string
}

type fileResultStore struct {
	TabID      string
	Lines      []StoredGrepLine
	BaseIndex  int
	Status     string
	Message    string
	StartTime  time.Time
	DurationMs int64
	Truncated  bool
	Active     bool
}

type storedFindMatch struct {
	LineIndex int
	Start     int
	End       int
}

var searchResults = newResultStore()

func newResultStore() *resultStore {
	return &resultStore{servers: make(map[string]*serverSearchStore)}
}

func (store *resultStore) StartRun(serverID string, tabs []string) string {
	store.mu.Lock()
	defer store.mu.Unlock()

	store.nextRun++
	runID := strconv.FormatInt(store.nextRun, 10)
	serverStore := &serverSearchStore{
		RunID:     runID,
		Files:     make(map[string]*fileResultStore),
		TabOrder:  append([]string(nil), tabs...),
		StartTime: time.Now(),
		Status:    searchStatusSearching,
	}
	for _, tabID := range tabs {
		serverStore.Files[tabID] = &fileResultStore{
			TabID:     tabID,
			Status:    searchStatusQueued,
			StartTime: serverStore.StartTime,
		}
	}
	store.servers[serverID] = serverStore
	return runID
}

func (store *resultStore) ClearServer(serverID string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.servers, serverID)
}

func (store *resultStore) SetTabs(serverID, runID string, tabs []string) bool {
	store.mu.Lock()
	defer store.mu.Unlock()
	serverStore := store.validRunLocked(serverID, runID)
	if serverStore == nil {
		return false
	}
	serverStore.TabOrder = append([]string(nil), tabs...)
	for _, tabID := range tabs {
		if serverStore.Files[tabID] == nil {
			serverStore.Files[tabID] = &fileResultStore{
				TabID:     tabID,
				Status:    searchStatusQueued,
				StartTime: serverStore.StartTime,
			}
		}
	}
	return true
}

func (store *resultStore) StartFile(serverID, runID, tabID string) bool {
	store.mu.Lock()
	defer store.mu.Unlock()
	fileStore := store.fileLocked(serverID, runID, tabID)
	if fileStore == nil {
		return false
	}
	fileStore.Status = searchStatusSearching
	fileStore.Message = ""
	fileStore.Active = true
	fileStore.StartTime = time.Now()
	return true
}

func (store *resultStore) AppendLine(serverID, runID, tabID string, line GrepLine) (SearchFileState, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	fileStore := store.fileLocked(serverID, runID, tabID)
	if fileStore == nil {
		return SearchFileState{}, false
	}

	if fileStore.Status == searchStatusQueued {
		fileStore.Status = searchStatusSearching
	}
	fileStore.Active = fileStore.Status == searchStatusSearching
	index := fileStore.BaseIndex + len(fileStore.Lines)
	fileStore.Lines = append(fileStore.Lines, StoredGrepLine{
		Index:     index,
		Text:      line.Text,
		Matches:   line.Matches,
		File:      line.File,
		IsContext: line.IsContext,
		Error:     line.Error,
	})
	if len(fileStore.Lines) > maxStoredLinesPerFile {
		overflow := len(fileStore.Lines) - maxStoredLinesPerFile
		fileStore.Lines = append([]StoredGrepLine(nil), fileStore.Lines[overflow:]...)
		fileStore.BaseIndex += overflow
		fileStore.Truncated = true
	}
	if line.Error != "" {
		fileStore.Status = searchStatusError
		fileStore.Message = line.Error
		fileStore.Active = false
	}
	return fileStore.snapshot(), true
}

func (store *resultStore) FinishFile(serverID, runID, tabID, status, message string) bool {
	store.mu.Lock()
	defer store.mu.Unlock()
	fileStore := store.fileLocked(serverID, runID, tabID)
	if fileStore == nil {
		return false
	}
	if fileStore.Status == searchStatusError && status != searchStatusCancelled {
		fileStore.Active = false
		fileStore.DurationMs = time.Since(fileStore.StartTime).Milliseconds()
		return true
	}
	fileStore.Status = status
	fileStore.Message = message
	fileStore.Active = false
	fileStore.DurationMs = time.Since(fileStore.StartTime).Milliseconds()
	return true
}

func (store *resultStore) FinishRun(serverID, runID, status, message string) (SearchStatePayload, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	serverStore := store.validRunLocked(serverID, runID)
	if serverStore == nil {
		return SearchStatePayload{}, false
	}
	serverStore.Status = status
	serverStore.Message = message
	for _, fileStore := range serverStore.Files {
		if fileStore.Status == searchStatusQueued || fileStore.Status == searchStatusSearching {
			fileStore.Status = status
			fileStore.Message = message
			fileStore.Active = false
			fileStore.DurationMs = time.Since(fileStore.StartTime).Milliseconds()
		}
	}
	return serverStore.snapshot(serverID), true
}

func (store *resultStore) State(serverID, runID string) (SearchStatePayload, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	serverStore := store.validRunLocked(serverID, runID)
	if serverStore == nil {
		return SearchStatePayload{}, false
	}
	return serverStore.snapshot(serverID), true
}

func (store *resultStore) Peek(serverID, runID, tabID string, offset, limit int) SearchPeekResult {
	if limit <= 0 {
		limit = defaultPeekLimit
	}
	if limit > maxPeekLimit {
		limit = maxPeekLimit
	}
	if offset < 0 {
		offset = 0
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	fileStore := store.fileLocked(serverID, runID, tabID)
	if fileStore == nil {
		return SearchPeekResult{
			RunID:   runID,
			TabID:   tabID,
			Offset:  offset,
			Lines:   []StoredGrepLine{},
			Status:  searchStatusDone,
			Message: fmt.Sprintf("search result not found for server=%s run=%s tab=%s", serverID, runID, tabID),
		}
	}

	total := len(fileStore.Lines)
	start := offset
	if start >= len(fileStore.Lines) {
		return SearchPeekResult{
			RunID:      runID,
			TabID:      tabID,
			Total:      total,
			Offset:     offset,
			Lines:      []StoredGrepLine{},
			Status:     fileStore.Status,
			Message:    fileStore.Message,
			DurationMs: fileStore.DurationMs,
			Truncated:  fileStore.Truncated,
		}
	}
	end := start + limit
	if end > len(fileStore.Lines) {
		end = len(fileStore.Lines)
	}
	lines := append([]StoredGrepLine(nil), fileStore.Lines[start:end]...)
	for i := range lines {
		lines[i].Index = offset + i
	}
	return SearchPeekResult{
		RunID:      runID,
		TabID:      tabID,
		Total:      total,
		Offset:     offset,
		Lines:      lines,
		Status:     fileStore.Status,
		Message:    fileStore.Message,
		DurationMs: fileStore.DurationMs,
		Truncated:  fileStore.Truncated,
	}
}

func (store *resultStore) Find(serverID, runID, tabID, keyword, direction string, fromLine, fromColumn int, ignoreCase bool) SearchFindResult {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return SearchFindResult{
			RunID:     runID,
			TabID:     tabID,
			Keyword:   keyword,
			Status:    searchStatusDone,
			Message:   "keyword is empty",
			LineIndex: -1,
			Ordinal:   0,
		}
	}
	if direction != "prev" {
		direction = "next"
	}
	if fromLine < 0 {
		fromLine = 0
	}
	if fromColumn < 0 {
		fromColumn = 0
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	fileStore := store.fileLocked(serverID, runID, tabID)
	if fileStore == nil {
		return SearchFindResult{
			RunID:     runID,
			TabID:     tabID,
			Keyword:   keyword,
			Status:    searchStatusDone,
			Message:   fmt.Sprintf("search result not found for server=%s run=%s tab=%s", serverID, runID, tabID),
			LineIndex: -1,
			Ordinal:   0,
		}
	}

	matches := fileStore.findMatches(keyword, ignoreCase)
	if len(matches) == 0 {
		return SearchFindResult{
			RunID:      runID,
			TabID:      tabID,
			Keyword:    keyword,
			Total:      0,
			Ordinal:    0,
			LineIndex:  -1,
			Status:     fileStore.Status,
			Message:    fileStore.Message,
			DurationMs: fileStore.DurationMs,
			Truncated:  fileStore.Truncated,
		}
	}

	selected := 0
	if direction == "prev" {
		selected = len(matches) - 1
		for i := len(matches) - 1; i >= 0; i-- {
			if matches[i].LineIndex < fromLine || (matches[i].LineIndex == fromLine && matches[i].Start < fromColumn) {
				selected = i
				break
			}
		}
	} else {
		for i, match := range matches {
			if match.LineIndex > fromLine || (match.LineIndex == fromLine && match.Start > fromColumn) {
				selected = i
				break
			}
		}
	}

	match := matches[selected]
	return SearchFindResult{
		RunID:      runID,
		TabID:      tabID,
		Keyword:    keyword,
		Total:      len(matches),
		Ordinal:    selected + 1,
		LineIndex:  match.LineIndex,
		Start:      match.Start,
		End:        match.End,
		Status:     fileStore.Status,
		Message:    fileStore.Message,
		DurationMs: fileStore.DurationMs,
		Truncated:  fileStore.Truncated,
	}
}

func (store *resultStore) validRunLocked(serverID, runID string) *serverSearchStore {
	serverStore := store.servers[serverID]
	if serverStore == nil || serverStore.RunID != runID {
		return nil
	}
	return serverStore
}

func (store *resultStore) fileLocked(serverID, runID, tabID string) *fileResultStore {
	serverStore := store.validRunLocked(serverID, runID)
	if serverStore == nil {
		return nil
	}
	if tabID == "" {
		tabID = fallbackResultsScope
	}
	fileStore := serverStore.Files[tabID]
	if fileStore == nil {
		fileStore = &fileResultStore{
			TabID:     tabID,
			Status:    searchStatusQueued,
			StartTime: serverStore.StartTime,
		}
		serverStore.Files[tabID] = fileStore
		serverStore.TabOrder = append(serverStore.TabOrder, tabID)
	}
	return fileStore
}

func (serverStore *serverSearchStore) snapshot(serverID string) SearchStatePayload {
	files := make([]SearchFileState, 0, len(serverStore.Files))
	total := 0
	truncated := false
	for _, tabID := range serverStore.TabOrder {
		fileStore := serverStore.Files[tabID]
		if fileStore == nil {
			continue
		}
		state := fileStore.snapshot()
		files = append(files, state)
		total += state.Total
		truncated = truncated || state.Truncated
	}
	return SearchStatePayload{
		ServerID:   serverID,
		RunID:      serverStore.RunID,
		Tabs:       append([]string(nil), serverStore.TabOrder...),
		Files:      files,
		Status:     serverStore.Status,
		Message:    serverStore.Message,
		Total:      total,
		DurationMs: time.Since(serverStore.StartTime).Milliseconds(),
		Truncated:  truncated,
		Active:     serverStore.Status == searchStatusSearching,
	}
}

func (fileStore *fileResultStore) snapshot() SearchFileState {
	duration := fileStore.DurationMs
	if fileStore.Active {
		duration = time.Since(fileStore.StartTime).Milliseconds()
	}
	return SearchFileState{
		TabID:      fileStore.TabID,
		Total:      len(fileStore.Lines),
		Status:     fileStore.Status,
		Message:    fileStore.Message,
		DurationMs: duration,
		Truncated:  fileStore.Truncated,
		Active:     fileStore.Active,
	}
}

func (fileStore *fileResultStore) findMatches(keyword string, ignoreCase bool) []storedFindMatch {
	if keyword == "" {
		return nil
	}
	needle := []rune(keyword)
	if ignoreCase {
		needle = []rune(strings.ToLower(keyword))
	}
	matches := make([]storedFindMatch, 0)
	for lineOffset, line := range fileStore.Lines {
		haystack := []rune(line.Text)
		if ignoreCase {
			haystack = []rune(strings.ToLower(line.Text))
		}
		for i := 0; i+len(needle) <= len(haystack); {
			if !runesEqual(haystack[i:i+len(needle)], needle) {
				i++
				continue
			}
			start := utf16Length(haystack[:i])
			end := start + utf16Length(haystack[i:i+len(needle)])
			matches = append(matches, storedFindMatch{
				LineIndex: lineOffset,
				Start:     start,
				End:       end,
			})
			i += len(needle)
		}
	}
	return matches
}

func runesEqual(left, right []rune) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func utf16Length(value []rune) int {
	length := 0
	for _, r := range value {
		if r > 0xFFFF {
			length += 2
		} else {
			length++
		}
	}
	return length
}

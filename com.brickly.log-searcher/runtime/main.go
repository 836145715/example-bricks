// BPP 协议主循环与命令分发器
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	brickly "github.com/836145715/brickly-sdk-go"
)

type LogFileConfig struct {
	Path    string `json:"path"`
	Enabled bool   `json:"enabled"`
}

type ServerConfig struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Type     string          `json:"type"` // "local" 或 "ssh"
	Host     string          `json:"host"`
	Port     int             `json:"port"`
	User     string          `json:"user"`
	AuthType string          `json:"authType"` // "password" 或 "key"
	Password string          `json:"password"`
	KeyPath  string          `json:"keyPath"`
	KeyText  string          `json:"keyText"`
	Logs     []LogFileConfig `json:"logs"`
}

const (
	brickID         = "com.brickly.log-searcher"
	protocolVersion = "0.1.0"
)

var (
	stdoutMu       sync.Mutex
	stdout         = bufio.NewWriter(os.Stdout)
	cancelMu       sync.Mutex
	cancelled      = make(map[string]bool)
	activeCancels  = make(map[string]context.CancelFunc)
	activeMu       sync.Mutex
	activeCommands = make(map[string]*activeCommand)
	// brickRuntime 供包内日志走 runtime.log，禁止 stderr 业务输出
	brickRuntime *brickly.Runtime
)

type activeCommand struct {
	ctx    *brickly.CommandContext
	result any
	err    error
}

// BPP 消息结构
type invokeMsg struct {
	Type      string         `json:"type"`
	ID        string         `json:"id"`
	CommandID string         `json:"commandId"`
	Input     map[string]any `json:"input"`
}

// Grep 参数
type GrepArgs struct {
	IgnoreCase   bool           `json:"ignoreCase"`   // -i
	Invert       bool           `json:"invert"`       // -v
	WordRegexp   bool           `json:"wordRegexp"`   // -w
	Regexp       bool           `json:"regexp"`       // -E
	ContextA     int            `json:"contextA"`     // -A
	ContextB     int            `json:"contextB"`     // -B
	ContextC     int            `json:"contextC"`     // -C
	OnlyMatch    bool           `json:"onlyMatch"`    // -o
	MaxCount     int            `json:"maxCount"`     // 每文件保留最新 N 条命中，0 表示不限
	ShowLineNum  bool           `json:"showLineNum"`  // -n
	ShowFilename bool           `json:"showFilename"` // -H
	FromTail     bool           `json:"fromTail"`     // 仅搜索文件尾部窗口
	TailLines    int            `json:"tailLines"`    // 尾部窗口行数
	Filters      []FilterConfig `json:"filters"`      // 链式过滤条件
}

type FilterConfig struct {
	Pattern    string `json:"pattern"`
	Regexp     bool   `json:"regexp"`
	IgnoreCase bool   `json:"ignoreCase"`
	Invert     bool   `json:"invert"`
	WordRegexp bool   `json:"wordRegexp"`
}

type searchInput struct {
	ServerID   string
	Pattern    string
	ResultMode string
	Args       GrepArgs
	LogPaths   []string
}

// -------------------- 协议消息读写 --------------------

// 向 stdout 发送 JSON 协议消息（多线程安全）
func send(msg map[string]any) {
	data, err := json.Marshal(msg)
	if err != nil {
		logError("marshal BPP message failed", err, nil)
		return
	}
	stdoutMu.Lock()
	defer stdoutMu.Unlock()
	stdout.Write(data)
	stdout.WriteByte('\n')
	stdout.Flush()
}

// -------------------- 结构化日志（plugin.log.* / runtime.log）--------------------
// 禁止业务日志写 stderr；宿主会把 stderr 记为 [已废弃] error。

func logDebug(message string, fields map[string]any) {
	if brickRuntime != nil {
		brickRuntime.Debug(message, fields)
	}
}

func logInfo(message string, fields map[string]any) {
	if brickRuntime != nil {
		brickRuntime.Info(message, fields)
	}
}

func logWarn(message string, fields map[string]any) {
	if brickRuntime != nil {
		brickRuntime.Warn(message, fields)
	}
}

func logError(message string, err error, fields map[string]any) {
	if brickRuntime != nil {
		brickRuntime.Error(message, err, fields)
	}
}

// 若在命令上下文内，优先挂到当前 command Span
func logWarnOn(requestID, message string, fields map[string]any) {
	if active := getActiveCommand(requestID); active != nil && active.ctx != nil {
		active.ctx.Warn(message, fields)
		return
	}
	logWarn(message, fields)
}

func logErrorOn(requestID, message string, err error, fields map[string]any) {
	if active := getActiveCommand(requestID); active != nil && active.ctx != nil {
		active.ctx.Error(message, err, fields)
		return
	}
	logError(message, err, fields)
}

// -------------------- 协议消息辅助 --------------------

func sendProgress(id string, p float64, message string) {
	if active := getActiveCommand(id); active != nil {
		active.ctx.Progress(p, message)
		return
	}
	m := map[string]any{"type": "command.progress", "id": id, "progress": p}
	if message != "" {
		m["message"] = message
	}
	send(m)
}

func sendChunk(id string, line GrepLine) {
	if active := getActiveCommand(id); active != nil {
		active.ctx.Chunk("logLine", line)
		return
	}
	send(map[string]any{
		"type":  "command.chunk",
		"id":    id,
		"name":  "logLine",
		"chunk": line,
	})
}

func sendSearchState(id string, state SearchStatePayload) {
	if active := getActiveCommand(id); active != nil {
		active.ctx.Chunk("searchState", state)
		return
	}
	send(map[string]any{
		"type":  "command.chunk",
		"id":    id,
		"name":  "searchState",
		"chunk": state,
	})
}

func sendResult(id string, result any) {
	if active := getActiveCommand(id); active != nil {
		active.result = result
		return
	}
	m := map[string]any{"type": "command.result", "id": id}
	if result != nil {
		m["result"] = result
	}
	send(m)
}

func sendError(id, code, message string) {
	if active := getActiveCommand(id); active != nil {
		active.err = brickly.NewBppError(code, message)
		return
	}
	send(map[string]any{
		"type":  "command.error",
		"id":    id,
		"error": map[string]any{"code": code, "message": message},
	})
}

func setActiveCommand(id string, active *activeCommand) {
	activeMu.Lock()
	defer activeMu.Unlock()
	activeCommands[id] = active
}

func getActiveCommand(id string) *activeCommand {
	activeMu.Lock()
	defer activeMu.Unlock()
	return activeCommands[id]
}

func deleteActiveCommand(id string) {
	activeMu.Lock()
	defer activeMu.Unlock()
	delete(activeCommands, id)
}

// -------------------- 取消机制 --------------------

func markCancelled(id string) {
	var cancel context.CancelFunc
	cancelMu.Lock()
	cancelled[id] = true
	cancel = activeCancels[id]
	cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func cancelActive(id string) {
	cancelMu.Lock()
	cancel := activeCancels[id]
	cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func clearCancelled(id string) {
	cancelMu.Lock()
	delete(cancelled, id)
	delete(activeCancels, id)
	cancelMu.Unlock()
}

func isCancelled(id string) bool {
	cancelMu.Lock()
	defer cancelMu.Unlock()
	return cancelled[id]
}

func registerCancel(id string, cancel context.CancelFunc) {
	cancelMu.Lock()
	activeCancels[id] = cancel
	shouldCancel := cancelled[id]
	cancelMu.Unlock()
	if shouldCancel {
		cancel()
	}
}

// -------------------- 配置文件读写 --------------------

func getConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".brickly")
	// 确保目录存在
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "log-searcher.json"), nil
}

func handleLoadConfig(id string) {
	path, err := getConfigPath()
	if err != nil {
		sendError(id, "CONFIG_DIR_ERROR", err.Error())
		return
	}

	// 如果配置文件不存在，返回空的默认配置
	if _, err := os.Stat(path); os.IsNotExist(err) {
		sendResult(id, map[string]any{
			"config": map[string]any{"servers": []any{}},
		})
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		sendError(id, "CONFIG_READ_ERROR", err.Error())
		return
	}

	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		sendError(id, "CONFIG_PARSE_ERROR", err.Error())
		return
	}

	sendResult(id, map[string]any{"config": parsed})
}

func handleSaveConfig(id string, input map[string]any) {
	configVal, ok := input["config"]
	if !ok {
		sendError(id, "INVALID_INPUT", "config is required")
		return
	}

	path, err := getConfigPath()
	if err != nil {
		sendError(id, "CONFIG_DIR_ERROR", err.Error())
		return
	}

	data, err := json.MarshalIndent(configVal, "", "  ")
	if err != nil {
		sendError(id, "CONFIG_MARSHAL_ERROR", err.Error())
		return
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		sendError(id, "CONFIG_WRITE_ERROR", err.Error())
		return
	}

	sendResult(id, map[string]any{"ok": true})
}

func parseServerConfigInput(input map[string]any) (ServerConfig, error) {
	serverVal, ok := input["server"]
	if !ok {
		return ServerConfig{}, fmt.Errorf("server is required")
	}

	serverBytes, err := json.Marshal(serverVal)
	if err != nil {
		return ServerConfig{}, err
	}

	var server ServerConfig
	if err := json.Unmarshal(serverBytes, &server); err != nil {
		return ServerConfig{}, err
	}

	return server, nil
}

func enabledLogPaths(server ServerConfig) []string {
	var paths []string
	for _, logConf := range server.Logs {
		if logConf.Enabled && logConf.Path != "" {
			paths = append(paths, logConf.Path)
		}
	}
	return paths
}

func handleTestConnection(id string, input map[string]any) {
	server, err := parseServerConfigInput(input)
	if err != nil {
		sendError(id, "INVALID_INPUT", err.Error())
		return
	}
	if server.Type == "" {
		sendError(id, "INVALID_INPUT", "server type is required")
		return
	}

	logPaths := enabledLogPaths(server)
	switch server.Type {
	case "local":
		if len(logPaths) == 0 {
			sendResult(id, map[string]any{
				"ok":      true,
				"message": "本地配置可用，但还没有启用的日志路径。",
			})
			return
		}

		files, err := ExpandLocalPaths(logPaths)
		if err != nil {
			sendError(id, "LOCAL_PATH_ERROR", err.Error())
			return
		}
		sendResult(id, map[string]any{
			"ok":         true,
			"message":    fmt.Sprintf("本地路径可访问，找到 %d 个日志文件。", len(files)),
			"filesCount": len(files),
		})
	case "ssh":
		client, err := dialSSHClient(server)
		if err != nil {
			sendError(id, "SSH_CONNECT_ERROR", err.Error())
			return
		}
		defer client.Close()

		filesCount := 0
		if len(logPaths) > 0 {
			files, err := ExpandRemotePaths(client, logPaths)
			if err != nil {
				sendError(id, "SSH_PATH_ERROR", err.Error())
				return
			}
			filesCount = len(files)
		}

		message := "SSH 连接成功。"
		if len(logPaths) > 0 {
			message = fmt.Sprintf("SSH 连接成功，找到 %d 个日志文件。", filesCount)
		}
		sendResult(id, map[string]any{
			"ok":         true,
			"message":    message,
			"filesCount": filesCount,
		})
	default:
		sendError(id, "UNKNOWN_SERVER_TYPE", "Unknown server type: "+server.Type)
	}
}

// 列出当前服务器配置下的所有日志具体文件列表
func handleListLogFiles(id string, input map[string]any) {
	serverId, _ := input["serverId"].(string)
	if serverId == "" {
		sendError(id, "INVALID_INPUT", "serverId is required")
		return
	}

	path, err := getConfigPath()
	if err != nil {
		sendError(id, "CONFIG_ERROR", err.Error())
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		sendError(id, "CONFIG_NOT_FOUND", "Please configure servers first.")
		return
	}

	var appConfig struct {
		Servers []ServerConfig `json:"servers"`
	}
	if err := json.Unmarshal(data, &appConfig); err != nil {
		sendError(id, "CONFIG_PARSE_ERROR", err.Error())
		return
	}

	var targetServer *ServerConfig
	for i := range appConfig.Servers {
		if appConfig.Servers[i].ID == serverId {
			targetServer = &appConfig.Servers[i]
			break
		}
	}

	if targetServer == nil {
		sendError(id, "SERVER_NOT_FOUND", "Server config not found: "+serverId)
		return
	}

	// 提取出所有日志路径配置（不管是否 Enabled，都列出来供前台多选）
	var configPaths []string
	for _, logConf := range targetServer.Logs {
		if logConf.Path != "" {
			configPaths = append(configPaths, logConf.Path)
		}
	}

	if len(configPaths) == 0 {
		sendResult(id, map[string]any{
			"files": []string{},
		})
		return
	}

	var expandedFiles []string
	if targetServer.Type == "local" {
		expandedFiles, err = ExpandLocalPaths(configPaths)
		if err != nil {
			sendError(id, "EXPAND_ERROR", err.Error())
			return
		}
	} else if targetServer.Type == "ssh" {
		// 远程 SSH 展开
		client, err := dialSSHClient(*targetServer)
		if err != nil {
			sendError(id, "SSH_CONNECT_ERROR", err.Error())
			return
		}
		defer client.Close()

		expandedFiles, err = ExpandRemotePaths(client, configPaths)
		if err != nil {
			sendError(id, "SSH_EXPAND_ERROR", err.Error())
			return
		}
	} else {
		sendError(id, "UNKNOWN_SERVER_TYPE", "Unknown server type: "+targetServer.Type)
		return
	}

	sendResult(id, map[string]any{
		"files": expandedFiles,
	})
}

// -------------------- 检索命令处理 --------------------

func parseGrepArgs(input map[string]any) GrepArgs {
	argsInput, _ := input["args"].(map[string]any)

	var args GrepArgs
	argsBytes, _ := json.Marshal(argsInput)
	json.Unmarshal(argsBytes, &args)

	if filtersVal, exists := input["filters"]; exists {
		filtersBytes, _ := json.Marshal(filtersVal)
		var filters []FilterConfig
		if err := json.Unmarshal(filtersBytes, &filters); err == nil {
			args.Filters = filters
		}
	}

	return args
}

func parseSearchInput(input map[string]any, targetServer ServerConfig) searchInput {
	parsed := searchInput{}
	parsed.ServerID, _ = input["serverId"].(string)
	parsed.Pattern, _ = input["pattern"].(string)
	parsed.ResultMode, _ = input["resultMode"].(string)
	parsed.Args = parseGrepArgs(input)

	if filesVal, exists := input["files"]; exists {
		if filesSlice, ok := filesVal.([]any); ok {
			for _, f := range filesSlice {
				if fStr, ok := f.(string); ok && fStr != "" {
					parsed.LogPaths = append(parsed.LogPaths, fStr)
				}
			}
		}
	}

	if len(parsed.LogPaths) == 0 {
		for _, logConf := range targetServer.Logs {
			if logConf.Enabled && logConf.Path != "" {
				parsed.LogPaths = append(parsed.LogPaths, logConf.Path)
			}
		}
	}

	return parsed
}

func handleSearch(id string, input map[string]any) {
	serverId, _ := input["serverId"].(string)

	if serverId == "" {
		sendError(id, "INVALID_INPUT", "serverId is required")
		return
	}

	// 获取服务器连接与路径配置
	path, err := getConfigPath()
	if err != nil {
		sendError(id, "CONFIG_ERROR", err.Error())
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		sendError(id, "CONFIG_NOT_FOUND", "Please configure servers first.")
		return
	}

	var appConfig struct {
		Servers []ServerConfig `json:"servers"`
	}
	if err := json.Unmarshal(data, &appConfig); err != nil {
		sendError(id, "CONFIG_PARSE_ERROR", err.Error())
		return
	}

	// 查找当前选中的服务器
	var targetServer *ServerConfig
	for i := range appConfig.Servers {
		if appConfig.Servers[i].ID == serverId {
			targetServer = &appConfig.Servers[i]
			break
		}
	}

	if targetServer == nil {
		sendError(id, "SERVER_NOT_FOUND", "Server config not found: "+serverId)
		return
	}

	search := parseSearchInput(input, *targetServer)

	if len(search.LogPaths) == 0 {
		sendError(id, "NO_LOG_PATHS", "No log files or paths specified for this search.")
		return
	}

	if search.ResultMode == storeResultMode {
		handleStoredSearch(id, *targetServer, search)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	registerCancel(id, cancel)
	defer clearCancelled(id)

	sendProgress(id, 0.1, "Connecting & searching logs...")

	var searchErr error
	if targetServer.Type == "local" {
		searchErr = RunLocalGrep(ctx, search.Pattern, search.LogPaths, search.Args, func(line GrepLine) {
			if ctx.Err() != nil || isCancelled(id) {
				return
			}
			sendChunk(id, line)
		})
	} else if targetServer.Type == "ssh" {
		searchErr = RunRemoteGrep(ctx, *targetServer, search.Pattern, search.LogPaths, search.Args, func(line GrepLine) {
			if ctx.Err() != nil || isCancelled(id) {
				return
			}
			sendChunk(id, line)
		})
	} else {
		sendError(id, "UNKNOWN_SERVER_TYPE", "Unknown server type: "+targetServer.Type)
		return
	}

	if searchErr != nil {
		if ctx.Err() != nil || isCancelled(id) {
			sendError(id, "CANCELLED", "Search cancelled by user.")
		} else {
			sendError(id, "SEARCH_FAILED", searchErr.Error())
		}
		return
	}

	sendProgress(id, 1.0, "Search completed successfully.")
	sendResult(id, map[string]any{"completed": true})
}

func handleStoredSearch(id string, targetServer ServerConfig, search searchInput) {
	cancelActive("server:" + search.ServerID)

	runID := searchResults.StartRun(search.ServerID, search.LogPaths)
	if state, ok := searchResults.State(search.ServerID, runID); ok {
		sendSearchState(id, state)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	registerCancel(id, cancel)
	registerCancel("server:"+search.ServerID, cancel)
	defer clearCancelled(id)
	defer clearCancelled("server:" + search.ServerID)

	sendProgress(id, 0.1, "Connecting & searching logs...")

	lastStateSent := time.Time{}
	emitState := func(force bool) {
		if !force && time.Since(lastStateSent) < 150*time.Millisecond {
			return
		}
		if state, ok := searchResults.State(search.ServerID, runID); ok {
			sendSearchState(id, state)
			lastStateSent = time.Now()
		}
	}

	appendLine := func(line GrepLine) {
		if ctx.Err() != nil || isCancelled(id) {
			return
		}
		tabID := line.File
		if tabID == "" {
			tabID = fallbackResultsScope
		}
		if _, ok := searchResults.AppendLine(search.ServerID, runID, tabID, line); ok {
			emitState(line.Error != "")
		}
	}

	var searchErr error
	if targetServer.Type == "local" {
		if expanded, err := ExpandLocalPaths(search.LogPaths); err == nil && len(expanded) > 0 {
			searchResults.SetTabs(search.ServerID, runID, expanded)
			emitState(true)
		}
		searchErr = runStoredLocalGrep(ctx, search.ServerID, runID, search.Pattern, search.LogPaths, search.Args, appendLine)
	} else if targetServer.Type == "ssh" {
		searchErr = runStoredRemoteGrep(ctx, targetServer, search, runID, appendLine)
	} else {
		sendError(id, "UNKNOWN_SERVER_TYPE", "Unknown server type: "+targetServer.Type)
		return
	}

	if searchErr != nil {
		status := searchStatusError
		message := searchErr.Error()
		if ctx.Err() != nil || isCancelled(id) {
			status = searchStatusCancelled
			message = "Search cancelled by user."
		}
		if state, ok := searchResults.FinishRun(search.ServerID, runID, status, message); ok {
			sendSearchState(id, state)
		}
		if status == searchStatusCancelled {
			sendError(id, "CANCELLED", message)
		} else {
			sendError(id, "SEARCH_FAILED", message)
		}
		return
	}

	if state, ok := searchResults.FinishRun(search.ServerID, runID, searchStatusSuccess, ""); ok {
		sendSearchState(id, state)
	}
	sendProgress(id, 1.0, "Search completed successfully.")
	sendResult(id, map[string]any{"completed": true, "runId": runID})
}

func runStoredLocalGrep(ctx context.Context, serverID, runID, pattern string, logPaths []string, args GrepArgs, onLine func(line GrepLine)) error {
	return RunLocalGrep(ctx, pattern, logPaths, args, func(line GrepLine) {
		tabID := line.File
		if tabID == "" {
			tabID = fallbackResultsScope
		}
		searchResults.StartFile(serverID, runID, tabID)
		onLine(line)
	})
}

func runStoredRemoteGrep(ctx context.Context, targetServer ServerConfig, search searchInput, runID string, onLine func(line GrepLine)) error {
	return RunRemoteGrepWithFiles(ctx, targetServer, search.Pattern, search.LogPaths, search.Args, func(files []string) {
		searchResults.SetTabs(search.ServerID, runID, files)
	}, func(line GrepLine) {
		tabID := line.File
		if tabID == "" {
			tabID = fallbackResultsScope
		}
		searchResults.StartFile(search.ServerID, runID, tabID)
		onLine(line)
	})
}

func handlePeekSearchResults(id string, input map[string]any) {
	serverID, _ := input["serverId"].(string)
	runID, _ := input["runId"].(string)
	tabID, _ := input["tabId"].(string)
	if serverID == "" || runID == "" || tabID == "" {
		sendError(id, "INVALID_INPUT", "serverId, runId and tabId are required")
		return
	}

	offset := intFromInput(input["offset"], 0)
	limit := intFromInput(input["limit"], defaultPeekLimit)
	sendResult(id, searchResults.Peek(serverID, runID, tabID, offset, limit))
}

func handleFindSearchResults(id string, input map[string]any) {
	serverID, _ := input["serverId"].(string)
	runID, _ := input["runId"].(string)
	tabID, _ := input["tabId"].(string)
	keyword, _ := input["keyword"].(string)
	direction, _ := input["direction"].(string)
	if serverID == "" || runID == "" || tabID == "" {
		sendError(id, "INVALID_INPUT", "serverId, runId and tabId are required")
		return
	}

	fromLine := intFromInput(input["fromLine"], -1)
	fromColumn := intFromInput(input["fromColumn"], -1)
	ignoreCase := boolFromInput(input["ignoreCase"], true)
	sendResult(id, searchResults.Find(serverID, runID, tabID, keyword, direction, fromLine, fromColumn, ignoreCase))
}

func handleClearSearchResults(id string, input map[string]any) {
	serverID, _ := input["serverId"].(string)
	if serverID == "" {
		sendError(id, "INVALID_INPUT", "serverId is required")
		return
	}
	cancelActive("server:" + serverID)
	searchResults.ClearServer(serverID)
	sendResult(id, map[string]any{"ok": true})
}

func boolFromInput(value any, fallback bool) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	}
	return fallback
}

func intFromInput(value any, fallback int) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return int(parsed)
		}
	}
	return fallback
}

// SDK 主入口
func main() {
	runtime := brickly.New(brickly.Options{BrickID: brickID})
	brickRuntime = runtime

	registerCommand := func(commandID string, handler func(string, map[string]any)) {
		runtime.OnCommand(commandID, func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
			payload := map[string]any{}
			_ = json.Unmarshal(input, &payload)
			active := &activeCommand{ctx: ctx}
			setActiveCommand(ctx.RequestID, active)
			defer deleteActiveCommand(ctx.RequestID)
			defer clearCancelled(ctx.RequestID)

			done := make(chan struct{})
			go func() {
				select {
				case <-ctx.Context().Done():
					markCancelled(ctx.RequestID)
				case <-done:
				}
			}()
			defer close(done)

			// 不再打 invoke start/end：宿主 Trace 已覆盖调用生命周期，stderr 噪音无价值
			handler(ctx.RequestID, payload)
			if active.err != nil {
				return nil, active.err
			}
			return active.result, nil
		})
	}

	registerCommand("search", handleSearch)
	registerCommand("peek_search_results", handlePeekSearchResults)
	registerCommand("find_search_results", handleFindSearchResults)
	registerCommand("clear_search_results", handleClearSearchResults)
	registerCommand("save_config", handleSaveConfig)
	registerCommand("test_connection", handleTestConnection)
	registerCommand("list_log_files", handleListLogFiles)
	registerCommand("load_config", func(id string, _ map[string]any) {
		handleLoadConfig(id)
	})

	runtime.Start()
}

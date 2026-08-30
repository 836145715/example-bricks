// 日志查询工具 runtime：gRPC Runtime + invoke/interact。
// search 走 call（ctx.Send 推 progress / searchState / logLine），其余命令走 invoke。
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
	Host     string          `json:"host"`
	Port     int             `json:"port"`
	User     string          `json:"user"`
	AuthType string          `json:"authType"` // "password" 或 "key"
	Password string          `json:"password"`
	KeyPath  string          `json:"keyPath"`
	KeyText  string          `json:"keyText"`
	Logs     []LogFileConfig `json:"logs"`
}


// brickRuntime 供包内日志走 SDK；禁止 stderr 业务输出。
var brickRuntime *brickly.Runtime

type GrepArgs struct {
	IgnoreCase   bool           `json:"ignoreCase"`
	Invert       bool           `json:"invert"`
	WordRegexp   bool           `json:"wordRegexp"`
	Regexp       bool           `json:"regexp"`
	ContextA     int            `json:"contextA"`
	ContextB     int            `json:"contextB"`
	ContextC     int            `json:"contextC"`
	OnlyMatch    bool           `json:"onlyMatch"`
	MaxCount     int            `json:"maxCount"`
	ShowLineNum  bool           `json:"showLineNum"`
	ShowFilename bool           `json:"showFilename"`
	FromTail     bool           `json:"fromTail"`
	TailLines    int            `json:"tailLines"`
	TailBytes    int            `json:"tailBytes"`
	Filters      []FilterConfig `json:"filters"`
}

type FilterConfig struct {
	Pattern    string `json:"pattern"`
	Regexp     bool   `json:"regexp"`
	IgnoreCase bool   `json:"ignoreCase"`
	Invert     bool   `json:"invert"`
	WordRegexp bool   `json:"wordRegexp"`
}

type searchInput struct {
	ServerID         string
	Pattern          string
	ResultMode       string
	Args             GrepArgs
	LogPaths         []string
	HasExplicitFiles bool
}

func commandError(code, message string) error {
	return brickly.NewBppError(code, message)
}

func decodeCommandInput(input json.RawMessage) map[string]any {
	payload := map[string]any{}
	if len(input) > 0 {
		_ = json.Unmarshal(input, &payload)
	}
	return payload
}

// asJSONValue 把结构体收成 BrickValue 能编码的 JSON 值（map / slice / 标量）。
func asJSONValue(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func sendProgress(ctx *brickly.CommandContext, progress float64, message string) error {
	return ctx.Send(map[string]any{
		"type":     "progress",
		"progress": progress,
		"message":  message,
	})
}

func sendLogLine(ctx *brickly.CommandContext, line GrepLine) error {
	payload, err := asJSONValue(line)
	if err != nil {
		return err
	}
	return ctx.Send(map[string]any{
		"type":    "logLine",
		"logLine": payload,
	})
}

func sendSearchState(ctx *brickly.CommandContext, state SearchStatePayload) error {
	payload, err := asJSONValue(state)
	if err != nil {
		return err
	}
	return ctx.Send(map[string]any{
		"type":        "searchState",
		"searchState": payload,
	})
}

func searchCancelled(ctx context.Context) bool {
	return ctx.Err() != nil
}

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

func getConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".brickly")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "log-searcher.json"), nil
}

func handleLoadConfig(_ *brickly.CommandContext) (any, error) {
	path, err := getConfigPath()
	if err != nil {
		return nil, commandError("CONFIG_DIR_ERROR", err.Error())
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		return map[string]any{
			"config": map[string]any{"servers": []any{}},
		}, nil
	}

	data, err := configFiles.Read(path)
	if err != nil {
		return nil, commandError("CONFIG_READ_ERROR", err.Error())
	}

	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, commandError("CONFIG_PARSE_ERROR", err.Error())
	}

	return map[string]any{"config": parsed}, nil
}

func handleSaveConfig(_ *brickly.CommandContext, input map[string]any) (any, error) {
	configVal, ok := input["config"]
	if !ok {
		return nil, commandError("INVALID_INPUT", "config is required")
	}

	path, err := getConfigPath()
	if err != nil {
		return nil, commandError("CONFIG_DIR_ERROR", err.Error())
	}

	data, err := json.MarshalIndent(configVal, "", "  ")
	if err != nil {
		return nil, commandError("CONFIG_MARSHAL_ERROR", err.Error())
	}

	if err := configFiles.Write(path, data); err != nil {
		return nil, commandError("CONFIG_WRITE_ERROR", err.Error())
	}

	return map[string]any{"ok": true}, nil
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
	return server, validateSSHServer(server)
}

func validateSSHServer(server ServerConfig) error {
	if server.Host == "" {
		return fmt.Errorf("SSH host is required")
	}
	if server.User == "" {
		return fmt.Errorf("SSH user is required")
	}
	return nil
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

func handleTestConnection(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	server, err := parseServerConfigInput(input)
	if err != nil {
		return nil, commandError("INVALID_INPUT", err.Error())
	}
	logPaths := enabledLogPaths(server)
	client, release, err := acquireSSHClient(ctx.Context(), server)
	if err != nil {
		return nil, commandError("SSH_CONNECT_ERROR", err.Error())
	}
	defer release()

	filesCount := 0
	if len(logPaths) > 0 {
		files, err := ExpandRemotePaths(client, logPaths)
		if err != nil {
			return nil, commandError("SSH_PATH_ERROR", err.Error())
		}
		filesCount = len(files)
	}

	message := "SSH 连接成功。"
	if len(logPaths) > 0 {
		message = fmt.Sprintf("SSH 连接成功，找到 %d 个日志文件。", filesCount)
	}
	return map[string]any{
		"ok":         true,
		"message":    message,
		"filesCount": filesCount,
	}, nil
}

func resolveBrowseServer(input map[string]any) (ServerConfig, error) {
	if _, ok := input["server"]; ok {
		server, err := parseServerConfigInput(input)
		if err != nil {
			return ServerConfig{}, commandError("INVALID_INPUT", err.Error())
		}
		return server, nil
	}
	serverID := stringFromInput(input["serverId"])
	if serverID == "" {
		return ServerConfig{}, commandError("INVALID_INPUT", "server or serverId is required")
	}
	loaded, err := loadServerConfig(serverID)
	if err != nil {
		return ServerConfig{}, err
	}
	return *loaded, nil
}

func handleBrowseRemotePath(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	server, err := resolveBrowseServer(input)
	if err != nil {
		return nil, err
	}
	client, release, err := acquireSSHClient(ctx.Context(), server)
	if err != nil {
		return nil, commandError("SSH_CONNECT_ERROR", err.Error())
	}
	defer release()

	path := stringFromInput(input["path"])
	result, err := BrowseRemotePath(ctx.Context(), client, path)
	if err != nil {
		return nil, commandError("BROWSE_FAILED", err.Error())
	}
	return asJSONValue(result)
}

func handleListLogFiles(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	serverId, _ := input["serverId"].(string)
	if serverId == "" {
		return nil, commandError("INVALID_INPUT", "serverId is required")
	}

	path, err := getConfigPath()
	if err != nil {
		return nil, commandError("CONFIG_ERROR", err.Error())
	}

	data, err := configFiles.Read(path)
	if err != nil {
		return nil, commandError("CONFIG_NOT_FOUND", "Please configure servers first.")
	}

	var appConfig struct {
		Servers []ServerConfig `json:"servers"`
	}
	if err := json.Unmarshal(data, &appConfig); err != nil {
		return nil, commandError("CONFIG_PARSE_ERROR", err.Error())
	}

	var targetServer *ServerConfig
	for i := range appConfig.Servers {
		if appConfig.Servers[i].ID == serverId {
			targetServer = &appConfig.Servers[i]
			break
		}
	}

	if targetServer == nil {
		return nil, commandError("SERVER_NOT_FOUND", "Server config not found: "+serverId)
	}
	if err := validateSSHServer(*targetServer); err != nil {
		return nil, commandError("INVALID_SERVER_CONFIG", err.Error())
	}

	configPaths := enabledLogPaths(*targetServer)

	if len(configPaths) == 0 {
		return asJSONValue(map[string]any{
			"files":     []string{},
			"fileInfos": []RemoteLogFile{},
		})
	}

	client, release, err := acquireSSHClient(ctx.Context(), *targetServer)
	if err != nil {
		return nil, commandError("SSH_CONNECT_ERROR", err.Error())
	}
	defer release()

	expandedFiles, err := expandRemotePaths(ctx.Context(), client, configPaths)
	if err != nil {
		return nil, commandError("SSH_EXPAND_ERROR", err.Error())
	}
	fileInfos, err := ReadRemoteLogFileInfo(client, expandedFiles)
	files := expandedFiles
	if err != nil {
		logWarn("远程日志文件大小读取失败", map[string]any{"serverId": serverId, "error": err.Error()})
		fileInfos = []RemoteLogFile{}
	} else {
		files = filterSearchableRemoteLogFiles(fileInfos)
		filteredFileInfos := make([]RemoteLogFile, 0, len(files))
		searchablePaths := make(map[string]struct{}, len(files))
		for _, filePath := range files {
			searchablePaths[filePath] = struct{}{}
		}
		for _, file := range fileInfos {
			if _, ok := searchablePaths[file.Path]; ok {
				filteredFileInfos = append(filteredFileInfos, file)
			}
		}
		fileInfos = filteredFileInfos
	}

	return asJSONValue(map[string]any{
		"files":     files,
		"fileInfos": fileInfos,
	})
}

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
		parsed.HasExplicitFiles = true
		if filesSlice, ok := filesVal.([]any); ok {
			for _, f := range filesSlice {
				if fStr, ok := f.(string); ok && fStr != "" {
					parsed.LogPaths = append(parsed.LogPaths, fStr)
				}
			}
		}
	}

	if !parsed.HasExplicitFiles && len(parsed.LogPaths) == 0 {
		for _, logConf := range targetServer.Logs {
			if logConf.Enabled && logConf.Path != "" {
				parsed.LogPaths = append(parsed.LogPaths, logConf.Path)
			}
		}
	}

	return parsed
}

func loadServerConfig(serverId string) (*ServerConfig, error) {
	if serverId == "" {
		return nil, commandError("INVALID_INPUT", "serverId is required")
	}

	path, err := getConfigPath()
	if err != nil {
		return nil, commandError("CONFIG_ERROR", err.Error())
	}

	data, err := configFiles.Read(path)
	if err != nil {
		return nil, commandError("CONFIG_NOT_FOUND", "Please configure servers first.")
	}

	var appConfig struct {
		Servers []ServerConfig `json:"servers"`
	}
	if err := json.Unmarshal(data, &appConfig); err != nil {
		return nil, commandError("CONFIG_PARSE_ERROR", err.Error())
	}

	for i := range appConfig.Servers {
		if appConfig.Servers[i].ID == serverId {
			target := &appConfig.Servers[i]
			if err := validateSSHServer(*target); err != nil {
				return nil, commandError("INVALID_SERVER_CONFIG", err.Error())
			}
			return target, nil
		}
	}
	return nil, commandError("SERVER_NOT_FOUND", "Server config not found: "+serverId)
}

func handleSearch(cmd *brickly.CommandContext, input map[string]any) (any, error) {
	serverId, _ := input["serverId"].(string)
	targetServer, err := loadServerConfig(serverId)
	if err != nil {
		return nil, err
	}

	search := parseSearchInput(input, *targetServer)

	if search.HasExplicitFiles && len(search.LogPaths) == 0 {
		return nil, commandError("NO_FILES_SELECTED", "Select at least one loaded log file before searching.")
	}
	if len(search.LogPaths) == 0 {
		return nil, commandError("NO_LOG_PATHS", "No log files or paths specified for this search.")
	}

	if search.ResultMode == storeResultMode {
		return handleStoredSearch(cmd, *targetServer, search)
	}

	searchCtx := cmd.Context()
	if err := sendProgress(cmd, 0.1, "Connecting & searching logs..."); err != nil {
		return nil, err
	}

	fileLineCounts := map[string]int{}
	searchErr := RunRemoteGrep(searchCtx, *targetServer, search.Pattern, search.LogPaths, search.Args, func(line GrepLine) bool {
		if searchCancelled(searchCtx) {
			return true
		}
		_ = sendLogLine(cmd, line)
		fileID := line.File
		if fileID == "" {
			fileID = fallbackResultsScope
		}
		fileLineCounts[fileID]++
		return fileLineCounts[fileID] >= maxStoredLinesPerFile
	})

	if searchErr != nil {
		if searchCancelled(searchCtx) {
			return nil, commandError("CANCELLED", "Search cancelled by user.")
		}
		return nil, commandError("SEARCH_FAILED", searchErr.Error())
	}

	if err := sendProgress(cmd, 1.0, "Search completed successfully."); err != nil {
		return nil, err
	}
	return map[string]any{"completed": true}, nil
}

func handleStoredSearch(cmd *brickly.CommandContext, targetServer ServerConfig, search searchInput) (any, error) {
	searchCtx, cancel := context.WithCancel(cmd.Context())
	defer cancel()
	runID, activeSearch := storedSearches.Start(search.ServerID, search.LogPaths, cancel)
	defer storedSearches.Finish(search.ServerID, activeSearch)

	if state, ok := searchResults.State(search.ServerID, runID); ok {
		if err := sendSearchState(cmd, state); err != nil {
			return nil, err
		}
	}

	if err := sendProgress(cmd, 0.1, "Connecting & searching logs..."); err != nil {
		return nil, err
	}

	lastStateSent := time.Time{}
	emitState := func(force bool) {
		if !force && time.Since(lastStateSent) < 150*time.Millisecond {
			return
		}
		if state, ok := searchResults.State(search.ServerID, runID); ok {
			if err := sendSearchState(cmd, state); err == nil {
				lastStateSent = time.Now()
			}
		}
	}

	appendLine := func(line GrepLine) bool {
		if searchCancelled(searchCtx) {
			return true
		}
		tabID := line.File
		if tabID == "" {
			tabID = fallbackResultsScope
		}
		state, accepted := searchResults.AppendLine(search.ServerID, runID, tabID, line)
		if accepted {
			emitState(line.Error != "" || state.Truncated)
		}
		return state.Truncated && state.Total >= maxStoredLinesPerFile
	}
	finishFile := func(tabID string) {
		if searchResults.FinishFile(search.ServerID, runID, tabID, searchStatusSuccess, "") {
			emitState(true)
		}
	}
	startFile := func(tabID string) {
		startStoredSearchFile(searchResults, search.ServerID, runID, tabID, emitState)
	}

	searchErr := runStoredRemoteGrep(searchCtx, targetServer, search, runID, startFile, appendLine, finishFile)

	if searchErr != nil {
		status := searchStatusError
		message := searchErr.Error()
		if searchCancelled(searchCtx) {
			status = searchStatusCancelled
			message = "Search cancelled by user."
		}
		if state, ok := searchResults.FinishRun(search.ServerID, runID, status, message); ok {
			_ = sendSearchState(cmd, state)
		}
		if status == searchStatusCancelled {
			return nil, commandError("CANCELLED", message)
		}
		return nil, commandError("SEARCH_FAILED", message)
	}

	if state, ok := searchResults.FinishRun(search.ServerID, runID, searchStatusSuccess, ""); ok {
		if err := sendSearchState(cmd, state); err != nil {
			return nil, err
		}
	}
	if err := sendProgress(cmd, 1.0, "Search completed successfully."); err != nil {
		return nil, err
	}
	return map[string]any{"completed": true, "runId": runID}, nil
}

func startStoredSearchFile(
	store *resultStore,
	serverID string,
	runID string,
	tabID string,
	emitState func(force bool),
) {
	if store.StartFile(serverID, runID, tabID) {
		emitState(true)
	}
}

func runStoredRemoteGrep(
	ctx context.Context,
	targetServer ServerConfig,
	search searchInput,
	runID string,
	onFileStart func(tabID string),
	onLine grepLineHandler,
	onFileDone func(tabID string),
) error {
	return runRemoteGrepWithFileLifecycle(ctx, targetServer, search.Pattern, search.LogPaths, search.Args, func(files []string) {
		searchResults.SetTabs(search.ServerID, runID, files)
	}, onFileStart, onFileDone, onLine)
}

func handlePeekSearchResults(_ *brickly.CommandContext, input map[string]any) (any, error) {
	serverID, _ := input["serverId"].(string)
	runID, _ := input["runId"].(string)
	tabID, _ := input["tabId"].(string)
	if serverID == "" || runID == "" || tabID == "" {
		return nil, commandError("INVALID_INPUT", "serverId, runId and tabId are required")
	}

	offset := intFromInput(input["offset"], 0)
	limit := intFromInput(input["limit"], defaultPeekLimit)
	return asJSONValue(searchResults.Peek(serverID, runID, tabID, offset, limit))
}

func handleFindSearchResults(_ *brickly.CommandContext, input map[string]any) (any, error) {
	serverID, _ := input["serverId"].(string)
	runID, _ := input["runId"].(string)
	tabID, _ := input["tabId"].(string)
	keyword, _ := input["keyword"].(string)
	direction, _ := input["direction"].(string)
	if serverID == "" || runID == "" || tabID == "" {
		return nil, commandError("INVALID_INPUT", "serverId, runId and tabId are required")
	}

	fromLine := intFromInput(input["fromLine"], -1)
	fromColumn := intFromInput(input["fromColumn"], -1)
	ignoreCase := boolFromInput(input["ignoreCase"], true)
	return asJSONValue(searchResults.Find(serverID, runID, tabID, keyword, direction, fromLine, fromColumn, ignoreCase))
}

func handleClearSearchResults(_ *brickly.CommandContext, input map[string]any) (any, error) {
	serverID, _ := input["serverId"].(string)
	if serverID == "" {
		return nil, commandError("INVALID_INPUT", "serverId is required")
	}
	storedSearches.Clear(serverID)
	return map[string]any{"ok": true}, nil
}

func stringFromInput(value any) string {
	typed, _ := value.(string)
	return strings.TrimSpace(typed)
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

func main() {
	runtime := brickly.New()
	brickRuntime = runtime

	runtime.OnCommand("search", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleSearch(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("peek_search_results", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handlePeekSearchResults(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("find_search_results", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleFindSearchResults(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("clear_search_results", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleClearSearchResults(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("save_config", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleSaveConfig(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("test_connection", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleTestConnection(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("list_log_files", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleListLogFiles(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("browse_remote_path", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleBrowseRemotePath(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("load_config", func(ctx *brickly.CommandContext, _ json.RawMessage) (any, error) {
		return handleLoadConfig(ctx)
	})

	runtime.Start()
}

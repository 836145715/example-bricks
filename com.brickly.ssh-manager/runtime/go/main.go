package main

import (
	"context"
	"encoding/json"
	"time"

	"brickly/ssh-manager/internal/stdoutguard"
	brickly "github.com/836145715/brickly-sdk-go"
)

const brickID = "com.brickly.ssh-manager"

var (
	plugin   *brickly.Runtime
	hosts    = newConfigStore()
	sessions = newSessionHub()
	conns    = newConnPool()
)

func main() {
	plugin = brickly.New(brickly.Options{
		BrickID: brickID,
		Stdout:  stdoutguard.ProtocolStdout(),
	})
	plugin.OnShutdown(func() error {
		sessions.closeAll()
		conns.closeAll()
		return nil
	})
	plugin.OnCommand("list-hosts", handleListHosts)
	plugin.OnCommand("save-host", handleSaveHost)
	plugin.OnCommand("delete-host", handleDeleteHost)
	plugin.OnCommand("test-connection", handleTestConnection)
	plugin.OnCommand("exec", handleExec)
	plugin.OnCommand("open-session", handleOpenSession)
	plugin.OnCommand("write-session", handleWriteSession)
	plugin.OnCommand("resize-session", handleResizeSession)
	plugin.OnCommand("close-session", handleCloseSession)
	plugin.OnCommand("session-cwd", handleSessionCwd)
	plugin.OnCommand("sftp-list", handleSftpList)
	plugin.OnCommand("sftp-upload", handleSftpUpload)
	plugin.OnCommand("sftp-download", handleSftpDownload)
	plugin.Start()
}

func handleListHosts(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		Query string `json:"query"`
	}
	if len(input) > 0 {
		if err := json.Unmarshal(input, &params); err != nil {
			return nil, newInputError("invalid list-hosts input")
		}
	}
	items, err := hosts.List()
	if err != nil {
		return nil, newConfigError(err.Error())
	}
	filtered := make([]Host, 0, len(items))
	for _, host := range items {
		if matchHost(host, params.Query) {
			filtered = append(filtered, host)
		}
	}
	return map[string]any{"hosts": filtered}, nil
}

func handleSaveHost(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		Host any `json:"host"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid save-host input")
	}
	host, err := decodeHost(params.Host)
	if err != nil {
		return nil, err
	}
	if host.ID == "" {
		host.ID = newID()
	}
	saved, err := hosts.Upsert(host)
	if err != nil {
		return nil, newConfigError(err.Error())
	}
	ctx.Info("保存主机", hostLogFields(saved))
	return map[string]any{"host": saved}, nil
}

func handleDeleteHost(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		HostID string `json:"hostId"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid delete-host input")
	}
	hostID := normalizeID(params.HostID)
	if hostID == "" {
		return nil, newInputError("hostId is required")
	}
	found, err := hosts.Delete(hostID)
	if err != nil {
		return nil, newConfigError(err.Error())
	}
	if !found {
		return nil, newNotFoundError("host not found")
	}
	ctx.Info("删除主机", map[string]any{"id": hostID})
	return map[string]any{"ok": true}, nil
}

func handleTestConnection(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	host, err := decodeResolvedHost(input)
	if err != nil {
		return nil, err
	}
	timeout, cancel := context.WithTimeout(ctx.Context(), defaultDialTimeout+2*time.Second)
	defer cancel()
	latencyMs, err := testSSHConnection(timeout, host)
	if err != nil {
		ctx.Warn("连接测试失败", hostLogFields(host))
		return nil, err
	}
	return map[string]any{
		"ok":        true,
		"message":   formatConnectMessage(latencyMs),
		"latencyMs": latencyMs,
	}, nil
}

func handleExec(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		HostID    string `json:"hostId"`
		Host      any    `json:"host"`
		Command   string `json:"command"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid exec input")
	}
	host, err := resolveHost(hosts, params.HostID, params.Host)
	if err != nil {
		return nil, err
	}
	timeout, cancel := context.WithTimeout(ctx.Context(), clampExecTimeout(params.TimeoutMs))
	defer cancel()
	ctx.Info("执行远程命令", hostLogFields(host))
	result, err := runRemoteCommand(timeout, host, params.Command)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func handleOpenSession(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		HostID    string `json:"hostId"`
		SessionID string `json:"sessionId"`
		Cols      int    `json:"cols"`
		Rows      int    `json:"rows"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid open-session input")
	}
	host, err := resolveHost(hosts, params.HostID, nil)
	if err != nil {
		return nil, err
	}
	sessionID := normalizeID(params.SessionID)
	if sessionID == "" {
		sessionID = newID()
	}
	cols, rows := clampTermSize(params.Cols, params.Rows)

	conn, err := conns.acquireTerminal(host)
	if err != nil {
		return nil, err
	}

	sess, stdin, stdout, err := openPTY(conn.client, cols, rows)
	if err != nil {
		conns.releaseTerminal(host.ID)
		return nil, newSSHError("SSH_SESSION_ERROR", err.Error())
	}

	sessionCtx, cancel := context.WithCancel(ctx.Context())
	live := &liveSession{
		ID:     sessionID,
		HostID: host.ID,
		client: conn.client,
		sess:   sess,
		stdin:  stdin,
		cancel: cancel,
	}
	if err := sessions.add(live); err != nil {
		closeLiveSession(live)
		return nil, err
	}

	if outputErr := ctx.Output("session", map[string]any{
		"sessionId": sessionID,
		"hostId":    host.ID,
		"status":    "open",
	}); outputErr != nil {
		sessions.close(sessionID)
		return nil, outputErr
	}

	go func() {
		<-sessionCtx.Done()
		_ = sess.Close()
	}()

	ctx.Info("打开终端会话", map[string]any{"sessionId": sessionID, "hostId": host.ID})
	scan := &pidScanner{}
	copyPTY(sessionCtx, stdout, func(chunk []byte) {
		visible, pid := scan.push(chunk)
		if pid > 0 {
			sessions.setShellPID(sessionID, pid)
		}
		if len(visible) == 0 {
			return
		}
		_ = ctx.Chunk("data", map[string]any{
			"sessionId": sessionID,
			"encoding":  "base64",
			"bytes":     encodeBytes(visible),
		})
	})

	exitCode := 0
	if waitErr := sess.Wait(); waitErr != nil {
		if exitErr, ok := waitErr.(interface{ ExitStatus() int }); ok {
			exitCode = exitErr.ExitStatus()
		}
	}
	sessions.remove(sessionID)
	closeLiveSession(live)
	_ = ctx.Chunk("status", map[string]any{
		"sessionId": sessionID,
		"status":    "closed",
		"exitCode":  exitCode,
	})
	return map[string]any{
		"sessionId": sessionID,
		"exitCode":  exitCode,
	}, nil
}

func handleWriteSession(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		SessionID string `json:"sessionId"`
		Data      string `json:"data"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid write-session input")
	}
	sessionID := normalizeID(params.SessionID)
	if sessionID == "" {
		return nil, newInputError("sessionId is required")
	}
	data, err := decodeSessionData(params.Data)
	if err != nil {
		return nil, err
	}
	if err := sessions.write(sessionID, data); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func handleResizeSession(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		SessionID string `json:"sessionId"`
		Cols      int    `json:"cols"`
		Rows      int    `json:"rows"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid resize-session input")
	}
	sessionID := normalizeID(params.SessionID)
	if sessionID == "" {
		return nil, newInputError("sessionId is required")
	}
	cols, rows := clampTermSize(params.Cols, params.Rows)
	if err := sessions.resize(sessionID, cols, rows); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true}, nil
}

func handleCloseSession(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid close-session input")
	}
	sessionID := normalizeID(params.SessionID)
	if sessionID == "" {
		return nil, newInputError("sessionId is required")
	}
	sessions.close(sessionID)
	return map[string]any{"ok": true}, nil
}

func handleSessionCwd(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, newInputError("invalid session-cwd input")
	}
	sessionID := normalizeID(params.SessionID)
	if sessionID == "" {
		return nil, newInputError("sessionId is required")
	}
	client, pid, ok := sessions.shellLookup(sessionID)
	if !ok || client == nil {
		return nil, newNotFoundError("session not found")
	}
	timeout, cancel := context.WithTimeout(ctx.Context(), sessionCwdTimeout)
	defer cancel()
	path, err := readSessionCwd(timeout, client, pid)
	if err != nil {
		return nil, err
	}
	return map[string]any{"path": path, "pid": pid}, nil
}

func decodeResolvedHost(input json.RawMessage) (Host, error) {
	var params struct {
		HostID string `json:"hostId"`
		Host   any    `json:"host"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return Host{}, newInputError("invalid host input")
	}
	return resolveHost(hosts, params.HostID, params.Host)
}

package main

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	brickly "github.com/836145715/brickly-sdk-go"
)


var (
	plugin   *brickly.Runtime
	hosts    = newConfigStore()
	sessions = newSessionHub()
	conns    = newConnPool()
)

func main() {
	plugin = brickly.New()
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
	filtered := make([]map[string]any, 0, len(items))
	for _, host := range items {
		if matchHost(host, params.Query) {
			filtered = append(filtered, publicHost(host))
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
	host, err := decodeHostDraft(params.Host)
	if err != nil {
		return nil, err
	}
	if host.ID == "" {
		host.ID = newID()
	}
	if existing, ok, err := hosts.Get(host.ID); err != nil {
		return nil, newConfigError(err.Error())
	} else if ok {
		host = mergeHostSecrets(existing, host)
	}
	if err := validateHost(host); err != nil {
		return nil, err
	}
	saved, err := hosts.Upsert(host)
	if err != nil {
		return nil, newConfigError(err.Error())
	}
	ctx.Info("保存主机", hostLogFields(saved))
	return map[string]any{"host": publicHost(saved)}, nil
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

	if err := ctx.OnEvent(func(event any) {
		applySessionInput(sessionID, event)
	}); err != nil {
		sessions.remove(sessionID)
		closeLiveSession(live)
		return nil, err
	}

	go func() {
		<-ctx.Closed()
		cancel()
	}()
	go func() {
		<-sessionCtx.Done()
		_ = sess.Close()
	}()

	var emitMu sync.Mutex
	emit := func(fn func() error) {
		emitMu.Lock()
		defer emitMu.Unlock()
		_ = fn()
	}
	live.bindCwdEmitter(func() { emitCwdFromProc(ctx, sessionID, emit) })

	ctx.Info("打开终端会话", map[string]any{"sessionId": sessionID, "hostId": host.ID})
	var openErr error
	emit(func() error {
		openErr = sendSessionOpened(ctx, sessionID, host.ID)
		return openErr
	})
	if openErr != nil {
		sessions.remove(sessionID)
		closeLiveSession(live)
		return nil, openErr
	}

	scan := &ptyScanner{}
	copyPTY(sessionCtx, stdout, func(chunk []byte) {
		result := scan.push(chunk)
		if result.pid > 0 {
			sessions.setShellPID(sessionID, result.pid)
			go emitCwdFromProc(ctx, sessionID, emit)
			sessions.scheduleCwd(sessionID, cwdAfterBoot)
		}
		if result.cwd != "" {
			if current := sessions.get(sessionID); current == nil || current.takeCwd(result.cwd) {
				emit(func() error { return sendSessionCwd(ctx, sessionID, result.cwd, scan.pid) })
			}
		}
		if len(result.visible) == 0 {
			return
		}
		emit(func() error { return sendSessionData(ctx, sessionID, result.visible) })
	})

	exitCode := 0
	if waitErr := sess.Wait(); waitErr != nil {
		if exitErr, ok := waitErr.(interface{ ExitStatus() int }); ok {
			exitCode = exitErr.ExitStatus()
		}
	}
	sessions.remove(sessionID)
	closeLiveSession(live)
	emit(func() error { return sendSessionStatus(ctx, sessionID, exitCode) })
	return map[string]any{
		"sessionId": sessionID,
		"exitCode":  exitCode,
	}, nil
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

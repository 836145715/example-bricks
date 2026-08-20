package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	defaultExecTimeout = 30 * time.Second
	maxExecTimeout     = 120 * time.Second
	maxCommandRunes    = 4000
)

type execResult struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
}

func clampExecTimeout(timeoutMs int) time.Duration {
	if timeoutMs <= 0 {
		return defaultExecTimeout
	}
	timeout := time.Duration(timeoutMs) * time.Millisecond
	if timeout > maxExecTimeout {
		return maxExecTimeout
	}
	return timeout
}

func runRemoteCommand(ctx context.Context, host Host, command string) (execResult, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return execResult{}, newInputError("command is required")
	}
	if len([]rune(command)) > maxCommandRunes {
		return execResult{}, newInputError("command is too long")
	}

	client, err := conns.client(host)
	if err != nil {
		return execResult{}, err
	}

	session, err := client.NewSession()
	if err != nil {
		return execResult{}, newSSHError("SSH_SESSION_ERROR", err.Error())
	}
	defer session.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	errCh := make(chan error, 1)
	go func() {
		errCh <- session.Run(command)
	}()

	select {
	case <-ctx.Done():
		_ = session.Close()
		return execResult{}, newSSHError("SSH_TIMEOUT", "command cancelled or timed out")
	case err := <-errCh:
		result := execResult{
			Stdout: stdout.String(),
			Stderr: stderr.String(),
		}
		if err == nil {
			return result, nil
		}
		if exitErr, ok := err.(*ssh.ExitError); ok {
			result.ExitCode = exitErr.ExitStatus()
			return result, nil
		}
		return execResult{}, newSSHError("SSH_EXEC_ERROR", err.Error())
	}
}

func testSSHConnection(ctx context.Context, host Host) (int64, error) {
	started := time.Now()
	client, err := dialSSH(host)
	if err != nil {
		return 0, newSSHError("SSH_CONNECT_ERROR", err.Error())
	}
	defer client.Close()

	done := make(chan error, 1)
	go func() {
		session, err := client.NewSession()
		if err != nil {
			done <- err
			return
		}
		defer session.Close()
		done <- session.Run("true")
	}()

	select {
	case <-ctx.Done():
		return 0, newSSHError("SSH_TIMEOUT", "connection test timed out")
	case err := <-done:
		if err != nil {
			if _, ok := err.(*ssh.ExitError); ok {
				return time.Since(started).Milliseconds(), nil
			}
			return 0, newSSHError("SSH_CONNECT_ERROR", err.Error())
		}
		return time.Since(started).Milliseconds(), nil
	}
}

func formatConnectMessage(latencyMs int64) string {
	return fmt.Sprintf("SSH 连接成功，耗时 %d ms。", latencyMs)
}

package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"

	brickly "github.com/836145715/brickly-sdk-go"
	"golang.org/x/crypto/ssh"
)

const (
	// POSIX wrapper: print PID as OSC, then exec the login shell so the PID stays.
	shellBootCommand  = "exec /bin/sh -c 'printf \"\\033]7331;Pid=%s\\007\" \"$$\"; exec \"${SHELL:-/bin/sh}\" -l'"
	sessionCwdTimeout = 4 * time.Second
)

func procCwdPath(pid int) string {
	return fmt.Sprintf("/proc/%d/cwd", pid)
}

func readSessionCwd(ctx context.Context, client *ssh.Client, pid int, host Host) (string, error) {
	if client == nil {
		return "", newNotFoundError("session not found")
	}
	if pid <= 0 {
		return "", newSSHError("SESSION_CWD_UNAVAILABLE", "shell pid not ready")
	}
	if path, err := readCwdViaSFTP(host, procCwdPath(pid)); err == nil {
		return path, nil
	}
	return readCwdViaExec(ctx, client, pid)
}

func readCwdViaSFTP(host Host, procPath string) (string, error) {
	if host.ID == "" {
		return "", newInputError("hostId is required")
	}
	var path string
	err := conns.useSFTP(host, func(fsys remoteFS) error {
		target, readErr := fsys.ReadLink(procPath)
		if readErr != nil {
			return readErr
		}
		if !validRemoteCwd(target) {
			return newSSHError("SESSION_CWD_UNAVAILABLE", "invalid cwd")
		}
		path = target
		return nil
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

func readCwdViaExec(ctx context.Context, client *ssh.Client, pid int) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", newSSHError("SSH_SESSION_ERROR", err.Error())
	}
	defer session.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	cmd := fmt.Sprintf("readlink /proc/%d/cwd", pid)
	errCh := make(chan error, 1)
	go func() {
		errCh <- session.Run(cmd)
	}()

	select {
	case <-ctx.Done():
		_ = session.Close()
		return "", newSSHError("SSH_TIMEOUT", "read cwd timed out")
	case err := <-errCh:
		path := strings.TrimSpace(stdout.String())
		if err != nil {
			return "", newSSHError("SESSION_CWD_UNAVAILABLE", cwdReadError(err, path, stderr.String()))
		}
		if !validRemoteCwd(path) {
			return "", newSSHError("SESSION_CWD_UNAVAILABLE", "invalid cwd")
		}
		return path, nil
	}
}

func cwdReadError(err error, stdout, stderr string) string {
	detail := strings.TrimSpace(stderr)
	if detail == "" {
		detail = strings.TrimSpace(stdout)
	}
	if detail == "" {
		return err.Error()
	}
	return detail
}

func emitCwdFromProc(ctx *brickly.CommandContext, sessionID string, emit func(func() error)) {
	client, hostID, pid, ok := sessions.shellLookup(sessionID)
	if !ok || client == nil || pid <= 0 {
		return
	}
	timeout, cancel := context.WithTimeout(context.Background(), sessionCwdTimeout)
	defer cancel()
	path, err := readSessionCwd(timeout, client, pid, Host{ID: hostID})
	if err != nil {
		return
	}
	if live := sessions.get(sessionID); live != nil && !live.takeCwd(path) {
		return
	}
	emit(func() error { return sendSessionCwd(ctx, sessionID, path, pid) })
}

func validRemoteCwd(path string) bool {
	if path == "" || !strings.HasPrefix(path, "/") {
		return false
	}
	if strings.Contains(path, "\x00") || strings.ContainsAny(path, "\n\r") {
		return false
	}
	if strings.HasSuffix(path, " (deleted)") {
		return false
	}
	for _, r := range path {
		if r < 32 || !unicode.IsPrint(r) && r != '\t' {
			return false
		}
	}
	return true
}

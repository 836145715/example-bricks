package main

import (
	"context"
	"encoding/base64"
	"io"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	defaultCols     = 120
	defaultRows     = 32
	maxLiveSessions = 16
	ptyReadSize     = 8192
	cwdAfterEnter   = 350 * time.Millisecond
	cwdAfterBoot    = 600 * time.Millisecond
)

type ptyControl interface {
	WindowChange(h, w int) error
	Close() error
}

type liveSession struct {
	ID          string
	HostID      string
	client      *ssh.Client
	sess        ptyControl
	stdin       io.WriteCloser
	cancel      context.CancelFunc
	releaseOnce sync.Once
	shellPID    int
	cwdMu       sync.Mutex
	lastCwd     string
	cwdTimer    *time.Timer
	emitCwd     func()
}

type sessionHub struct {
	mu    sync.Mutex
	items map[string]*liveSession
}

func newSessionHub() *sessionHub {
	return &sessionHub{items: make(map[string]*liveSession)}
}

func (h *sessionHub) add(session *liveSession) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, exists := h.items[session.ID]; exists {
		return newInputError("session already exists")
	}
	if len(h.items) >= maxLiveSessions {
		return newSSHError("SESSION_LIMIT", "too many open sessions")
	}
	h.items[session.ID] = session
	return nil
}

func (h *sessionHub) remove(id string) *liveSession {
	h.mu.Lock()
	defer h.mu.Unlock()
	session := h.items[id]
	delete(h.items, id)
	return session
}

func (h *sessionHub) client(id string) (*ssh.Client, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	session := h.items[id]
	if session == nil || session.client == nil {
		return nil, false
	}
	return session.client, true
}

func (h *sessionHub) setShellPID(id string, pid int) {
	if pid <= 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	session := h.items[id]
	if session == nil || session.shellPID != 0 {
		return
	}
	session.shellPID = pid
}

func (h *sessionHub) get(id string) *liveSession {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.items[id]
}

func (h *sessionHub) scheduleCwd(id string, delay time.Duration) {
	if session := h.get(id); session != nil {
		session.scheduleCwd(delay)
	}
}

func (h *sessionHub) shellLookup(id string) (*ssh.Client, string, int, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	session := h.items[id]
	if session == nil {
		return nil, "", 0, false
	}
	return session.client, session.HostID, session.shellPID, true
}

func (h *sessionHub) write(id string, data []byte) error {
	h.mu.Lock()
	session := h.items[id]
	h.mu.Unlock()
	if session == nil {
		return newNotFoundError("session not found")
	}
	if len(data) == 0 {
		return nil
	}
	_, err := session.stdin.Write(data)
	if err != nil {
		return newSSHError("SESSION_WRITE_ERROR", err.Error())
	}
	return nil
}

func (h *sessionHub) resize(id string, cols, rows int) error {
	h.mu.Lock()
	session := h.items[id]
	h.mu.Unlock()
	if session == nil {
		return newNotFoundError("session not found")
	}
	if session.sess == nil {
		return newSSHError("SESSION_RESIZE_ERROR", "pty session is missing")
	}
	if err := session.sess.WindowChange(rows, cols); err != nil {
		return newSSHError("SESSION_RESIZE_ERROR", err.Error())
	}
	return nil
}

func (h *sessionHub) close(id string) bool {
	session := h.remove(id)
	if session == nil {
		return false
	}
	closeLiveSession(session)
	return true
}

func (h *sessionHub) closeAll() {
	h.mu.Lock()
	items := make([]*liveSession, 0, len(h.items))
	for id, session := range h.items {
		items = append(items, session)
		delete(h.items, id)
	}
	h.mu.Unlock()
	for _, session := range items {
		closeLiveSession(session)
	}
}

func closeLiveSession(session *liveSession) {
	session.stopCwdWatch()
	if session.cancel != nil {
		session.cancel()
	}
	if session.sess != nil {
		_ = session.sess.Close()
	}
	session.releaseOnce.Do(func() {
		conns.releaseTerminal(session.HostID)
	})
}

func (s *liveSession) bindCwdEmitter(emit func()) {
	s.cwdMu.Lock()
	s.emitCwd = emit
	s.cwdMu.Unlock()
}

func (s *liveSession) scheduleCwd(delay time.Duration) {
	if s == nil {
		return
	}
	s.cwdMu.Lock()
	defer s.cwdMu.Unlock()
	if s.emitCwd == nil {
		return
	}
	if s.cwdTimer != nil {
		s.cwdTimer.Stop()
	}
	emit := s.emitCwd
	s.cwdTimer = time.AfterFunc(delay, emit)
}

func (s *liveSession) stopCwdWatch() {
	s.cwdMu.Lock()
	defer s.cwdMu.Unlock()
	if s.cwdTimer != nil {
		s.cwdTimer.Stop()
		s.cwdTimer = nil
	}
}

func (s *liveSession) takeCwd(path string) bool {
	s.cwdMu.Lock()
	defer s.cwdMu.Unlock()
	if s.lastCwd == path {
		return false
	}
	s.lastCwd = path
	return true
}

func clampTermSize(cols, rows int) (int, int) {
	if cols < 20 {
		cols = defaultCols
	}
	if rows < 8 {
		rows = defaultRows
	}
	if cols > 400 {
		cols = 400
	}
	if rows > 200 {
		rows = 200
	}
	return cols, rows
}

func openPTY(client *ssh.Client, cols, rows int) (*ssh.Session, io.WriteCloser, io.Reader, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, nil, nil, err
	}
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = session.Close()
		return nil, nil, nil, err
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, nil, nil, err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, nil, nil, err
	}
	if err := session.Start(shellBootCommand); err != nil {
		_ = session.Close()
		return openLoginShell(client, cols, rows)
	}
	return session, stdin, stdout, nil
}

func openLoginShell(client *ssh.Client, cols, rows int) (*ssh.Session, io.WriteCloser, io.Reader, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, nil, nil, err
	}
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = session.Close()
		return nil, nil, nil, err
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, nil, nil, err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, nil, nil, err
	}
	if err := session.Shell(); err != nil {
		_ = session.Close()
		return nil, nil, nil, err
	}
	return session, stdin, stdout, nil
}

func copyPTY(ctx context.Context, reader io.Reader, emit func([]byte)) {
	buf := make([]byte, ptyReadSize)
	for {
		if ctx.Err() != nil {
			return
		}
		n, err := reader.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			emit(chunk)
		}
		if err != nil {
			return
		}
	}
}

func encodeBytes(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func decodeSessionData(raw string) ([]byte, error) {
	if raw == "" {
		return nil, nil
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, newInputError("data must be base64")
	}
	return data, nil
}

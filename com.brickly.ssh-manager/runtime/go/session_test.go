package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"testing"
	"time"
)

func TestClampTermSize(t *testing.T) {
	cols, rows := clampTermSize(0, 0)
	if cols != defaultCols || rows != defaultRows {
		t.Fatalf("defaults: %d x %d", cols, rows)
	}
	cols, rows = clampTermSize(800, 400)
	if cols != 400 || rows != 200 {
		t.Fatalf("max clamp: %d x %d", cols, rows)
	}
}

func TestSessionHubWriteAndClose(t *testing.T) {
	hub := newSessionHub()
	stdin := &bufferCloser{}
	session := &liveSession{
		ID:     "s1",
		HostID: "h1",
		stdin:  stdin,
		cancel: func() {},
	}
	if err := hub.add(session); err != nil {
		t.Fatal(err)
	}
	if err := hub.write("s1", []byte("ls\n")); err != nil {
		t.Fatal(err)
	}
	if stdin.buf.String() != "ls\n" {
		t.Fatalf("stdin mismatch: %q", stdin.buf.String())
	}
	if !hub.close("s1") {
		t.Fatal("expected close to find session")
	}
	if err := hub.write("s1", []byte("x")); err == nil {
		t.Fatal("write after close should fail")
	}
}

func TestSessionHubRejectsDuplicateAndLimit(t *testing.T) {
	hub := newSessionHub()
	if err := hub.add(&liveSession{ID: "s1", stdin: &bufferCloser{}}); err != nil {
		t.Fatal(err)
	}
	if err := hub.add(&liveSession{ID: "s1", stdin: &bufferCloser{}}); err == nil {
		t.Fatal("duplicate session should fail")
	}
	for i := 0; i < maxLiveSessions-1; i++ {
		if err := hub.add(&liveSession{ID: newID(), stdin: &bufferCloser{}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := hub.add(&liveSession{ID: "overflow", stdin: &bufferCloser{}}); err == nil {
		t.Fatal("expected session limit")
	}
}

func TestSessionHubStoresShellPID(t *testing.T) {
	hub := newSessionHub()
	if err := hub.add(&liveSession{ID: "s1", HostID: "h1", stdin: &bufferCloser{}}); err != nil {
		t.Fatal(err)
	}
	hub.setShellPID("s1", 42)
	hub.setShellPID("s1", 99)
	_, hostID, pid, ok := hub.shellLookup("s1")
	if !ok || pid != 42 || hostID != "h1" {
		t.Fatalf("pid=%d hostID=%s ok=%v", pid, hostID, ok)
	}
}

func TestDecodeSessionData(t *testing.T) {
	raw := base64.StdEncoding.EncodeToString([]byte("abc"))
	data, err := decodeSessionData(raw)
	if err != nil || string(data) != "abc" {
		t.Fatalf("decode failed: %q %v", data, err)
	}
	if _, err := decodeSessionData("@@@@"); err == nil {
		t.Fatal("expected invalid base64")
	}
}

func TestCopyPTYStopsOnCancel(t *testing.T) {
	reader, writer := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan []byte, 1)
	done := make(chan struct{})
	go func() {
		copyPTY(ctx, reader, func(chunk []byte) { got <- chunk })
		close(done)
	}()
	if _, err := writer.Write([]byte("hi")); err != nil {
		t.Fatal(err)
	}
	select {
	case chunk := <-got:
		if string(chunk) != "hi" {
			t.Fatalf("chunk=%q", chunk)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for chunk")
	}
	cancel()
	_ = writer.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("copyPTY did not stop")
	}
}

type bufferCloser struct {
	buf bytes.Buffer
}

func (b *bufferCloser) Write(p []byte) (int, error) { return b.buf.Write(p) }
func (b *bufferCloser) Close() error                { return nil }

type fakeSession struct {
	cols int
	rows int
}

func (s *fakeSession) WindowChange(h, w int) error {
	s.rows = h
	s.cols = w
	return nil
}

func (s *fakeSession) Close() error { return nil }

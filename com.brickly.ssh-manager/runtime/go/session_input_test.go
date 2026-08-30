package main

import (
	"encoding/base64"
	"testing"
	"time"
)

func TestParseSessionInputDataAndResize(t *testing.T) {
	data, err := parseSessionInput(map[string]any{
		"type":     "data",
		"encoding": "base64",
		"bytes":    base64.StdEncoding.EncodeToString([]byte("ls\n")),
	})
	if err != nil || string(data.Data) != "ls\n" {
		t.Fatalf("data: %#v %v", data, err)
	}

	resize, err := parseSessionInput(map[string]any{
		"type": "resize",
		"cols": int64(140),
		"rows": float64(40),
	})
	if err != nil || resize.Cols != 140 || resize.Rows != 40 {
		t.Fatalf("resize: %#v %v", resize, err)
	}
}

func TestParseSessionInputRejectsUnknown(t *testing.T) {
	if _, err := parseSessionInput(map[string]any{"type": "ping"}); err == nil {
		t.Fatal("expected unknown type")
	}
	if _, err := parseSessionInput("nope"); err == nil {
		t.Fatal("expected invalid object")
	}
	if _, err := parseSessionInput(map[string]any{"type": "data", "bytes": "@@@@"}); err == nil {
		t.Fatal("expected invalid base64")
	}
}

func TestApplySessionInputWritesAndResizes(t *testing.T) {
	original := sessions
	t.Cleanup(func() { sessions = original })
	sessions = newSessionHub()
	stdin := &bufferCloser{}
	sess := &fakeSession{}
	if err := sessions.add(&liveSession{
		ID:     "s1",
		HostID: "h1",
		stdin:  stdin,
		sess:   sess,
		cancel: func() {},
	}); err != nil {
		t.Fatal(err)
	}

	applySessionInput("s1", map[string]any{
		"type":  "data",
		"bytes": base64.StdEncoding.EncodeToString([]byte("pwd\n")),
	})
	if stdin.buf.String() != "pwd\n" {
		t.Fatalf("stdin=%q", stdin.buf.String())
	}

	applySessionInput("s1", map[string]any{"type": "resize", "cols": 80, "rows": 24})
	if sess.cols != 80 || sess.rows != 24 {
		t.Fatalf("resize=%dx%d", sess.cols, sess.rows)
	}

	applySessionInput("s1", map[string]any{"type": "unknown"})
}

func TestParseSessionInputCwd(t *testing.T) {
	input, err := parseSessionInput(map[string]any{"type": "cwd"})
	if err != nil || input.Type != "cwd" {
		t.Fatalf("cwd: %#v %v", input, err)
	}
}

func TestContainsCommandSubmit(t *testing.T) {
	if !containsCommandSubmit([]byte("cd /tmp\r")) || !containsCommandSubmit([]byte("ls\n")) {
		t.Fatal("expected enter/newline to count as submit")
	}
	if containsCommandSubmit([]byte("abc")) {
		t.Fatal("plain text is not submit")
	}
}

func TestApplySessionInputEnterSchedulesCwd(t *testing.T) {
	original := sessions
	t.Cleanup(func() { sessions = original })
	sessions = newSessionHub()
	called := make(chan struct{}, 1)
	live := &liveSession{ID: "s1", HostID: "h1", stdin: &bufferCloser{}, cancel: func() {}}
	live.bindCwdEmitter(func() { called <- struct{}{} })
	if err := sessions.add(live); err != nil {
		t.Fatal(err)
	}

	applySessionInput("s1", map[string]any{
		"type":  "data",
		"bytes": base64.StdEncoding.EncodeToString([]byte("cd /tmp\r")),
	})
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("expected cwd refresh after enter")
	}
}

func TestLiveSessionTakeCwdDedups(t *testing.T) {
	live := &liveSession{}
	if !live.takeCwd("/home") {
		t.Fatal("first path should emit")
	}
	if live.takeCwd("/home") {
		t.Fatal("same path should be skipped")
	}
	if !live.takeCwd("/tmp") {
		t.Fatal("changed path should emit")
	}
}

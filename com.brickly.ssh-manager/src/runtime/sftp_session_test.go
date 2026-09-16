package main

import (
	"strings"
	"testing"
)

func TestWithSFTPRequiresLiveSession(t *testing.T) {
	original := sessions
	t.Cleanup(func() { sessions = original })
	sessions = newSessionHub()

	err := withSFTP(Host{ID: "h1"}, "missing", func(remoteFS) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "session not found") {
		t.Fatalf("expected session not found, got %v", err)
	}
}

func TestWithSFTPRejectsHostMismatch(t *testing.T) {
	original := sessions
	t.Cleanup(func() { sessions = original })
	sessions = newSessionHub()
	if err := sessions.add(&liveSession{
		ID:     "s1",
		HostID: "h1",
		stdin:  &bufferCloser{},
		cancel: func() {},
	}); err != nil {
		t.Fatal(err)
	}

	err := withSFTP(Host{ID: "h2"}, "s1", func(remoteFS) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "session does not match host") {
		t.Fatalf("expected host mismatch, got %v", err)
	}
}

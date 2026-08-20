package main

import (
	"context"
	"strings"
	"testing"
)

func TestRunRemoteCommandRejectsEmpty(t *testing.T) {
	_, err := runRemoteCommand(context.Background(), Host{}, "   ")
	if err == nil || !strings.Contains(err.Error(), "command is required") {
		t.Fatalf("expected empty command error, got %v", err)
	}
}

func TestFormatConnectMessage(t *testing.T) {
	if !strings.Contains(formatConnectMessage(42), "42") {
		t.Fatal("latency should appear in message")
	}
}

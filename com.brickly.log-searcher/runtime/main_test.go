package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRegisterCancelTriggersContextImmediately(t *testing.T) {
	id := "test-cancel-immediate"
	clearCancelled(id)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	registerCancel(id, cancel)
	markCancelled(id)

	if ctx.Err() == nil {
		t.Fatalf("context should be cancelled after markCancelled")
	}
	if !isCancelled(id) {
		t.Fatalf("cancel flag should be set")
	}

	clearCancelled(id)
	if isCancelled(id) {
		t.Fatalf("cancel flag should be cleared")
	}
}

func TestRegisterCancelHonorsEarlierCancelSignal(t *testing.T) {
	id := "test-cancel-before-register"
	clearCancelled(id)
	markCancelled(id)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	registerCancel(id, cancel)

	if ctx.Err() == nil {
		t.Fatalf("context should be cancelled when id was cancelled before registration")
	}

	clearCancelled(id)
}

func TestParseServerConfigInput(t *testing.T) {
	server, err := parseServerConfigInput(map[string]any{
		"server": map[string]any{
			"id":       "srv_test",
			"name":     "测试服务器",
			"type":     "local",
			"host":     "localhost",
			"port":     22,
			"user":     "root",
			"authType": "password",
			"logs": []any{
				map[string]any{"path": "/tmp/app.log", "enabled": true},
				map[string]any{"path": "/tmp/skip.log", "enabled": false},
			},
		},
	})
	if err != nil {
		t.Fatalf("parseServerConfigInput() error = %v", err)
	}
	if server.ID != "srv_test" || server.Type != "local" || len(server.Logs) != 2 {
		t.Fatalf("unexpected server: %+v", server)
	}
}

func TestEnabledLogPaths(t *testing.T) {
	paths := enabledLogPaths(ServerConfig{
		Logs: []LogFileConfig{
			{Path: "/tmp/app.log", Enabled: true},
			{Path: "/tmp/skip.log", Enabled: false},
			{Path: "", Enabled: true},
		},
	})

	if len(paths) != 1 || paths[0] != "/tmp/app.log" {
		t.Fatalf("enabledLogPaths() = %v, want only /tmp/app.log", paths)
	}
}

func TestLocalTestConnectionPathExpansion(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "app.log")
	if err := os.WriteFile(logFile, []byte("ok\n"), 0644); err != nil {
		t.Fatalf("write log file: %v", err)
	}

	files, err := ExpandLocalPaths(enabledLogPaths(ServerConfig{
		Type: "local",
		Logs: []LogFileConfig{{Path: filepath.Join(dir, "*.log"), Enabled: true}},
	}))
	if err != nil {
		t.Fatalf("ExpandLocalPaths() error = %v", err)
	}
	if len(files) != 1 || files[0] != logFile {
		t.Fatalf("ExpandLocalPaths() = %v, want %q", files, logFile)
	}
}

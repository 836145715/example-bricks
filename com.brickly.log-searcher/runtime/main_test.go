package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
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
			"host":     "logs.example.internal",
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
	if server.ID != "srv_test" || len(server.Logs) != 2 {
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

func TestParseSearchInputDoesNotUseConfiguredPathsForExplicitEmptyFiles(t *testing.T) {
	server := ServerConfig{
		Logs: []LogFileConfig{{Path: "/var/log/app.log", Enabled: true}},
	}
	search := parseSearchInput(map[string]any{
		"files": []any{},
	}, server)

	if !search.HasExplicitFiles {
		t.Fatal("explicit files input should be recorded")
	}
	if len(search.LogPaths) != 0 {
		t.Fatalf("explicit empty files should not use configured paths: %v", search.LogPaths)
	}
}

func TestParseSearchInputUsesConfiguredPathsWhenFilesAreOmitted(t *testing.T) {
	server := ServerConfig{
		Logs: []LogFileConfig{{Path: "/var/log/app.log", Enabled: true}},
	}
	search := parseSearchInput(map[string]any{}, server)

	if search.HasExplicitFiles {
		t.Fatal("missing files input should not be recorded as explicit")
	}
	if len(search.LogPaths) != 1 || search.LogPaths[0] != "/var/log/app.log" {
		t.Fatalf("configured paths = %v, want enabled configured path", search.LogPaths)
	}
}

func TestStartStoredSearchFileEmitsStateImmediately(t *testing.T) {
	store := newResultStore()
	runID := store.StartRun("server", []string{"app.log"})
	emits := 0

	startStoredSearchFile(store, "server", runID, "app.log", func(force bool) {
		if !force {
			t.Fatal("file start should force a state update")
		}
		emits++
	})

	if emits != 1 {
		t.Fatalf("state emits = %d, want 1", emits)
	}
	state, ok := store.State("server", runID)
	if !ok || len(state.Files) != 1 {
		t.Fatalf("unexpected state: %+v", state)
	}
	if state.Files[0].Status != searchStatusSearching || !state.Files[0].Active {
		t.Fatalf("file should be shown as searching: %+v", state.Files[0])
	}
}

func TestStoredSearchControllerKeepsNewSearchRegisteredWhenOldSearchFinishes(t *testing.T) {
	store := newResultStore()
	controller := newStoredSearchController(store)

	oldCtx, oldCancel := context.WithCancel(context.Background())
	defer oldCancel()
	_, oldSearch := controller.Start("server", []string{"old.log"}, oldCancel)

	newCtx, newCancel := context.WithCancel(context.Background())
	defer newCancel()
	newRunID, newSearch := controller.Start("server", []string{"new.log"}, newCancel)
	if oldCtx.Err() == nil {
		t.Fatal("starting a replacement should cancel the previous search for the server")
	}

	controller.Finish("server", oldSearch)
	controller.Clear("server")
	if newCtx.Err() == nil {
		t.Fatal("clearing the server should still cancel the newest active search")
	}

	got := store.Peek("server", newRunID, "new.log", 0, 10)
	if got.Message == "" {
		t.Fatalf("cleared server should not retain the latest run: %+v", got)
	}
	controller.Finish("server", newSearch)
}

func TestConfigFileStoreKeepsReadsParseableDuringConcurrentWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	store := newConfigFileStore()
	if err := store.Write(path, []byte(`{"servers":[]}`)); err != nil {
		t.Fatalf("initial config write: %v", err)
	}

	errs := make(chan error, 32)
	var workers sync.WaitGroup
	for writer := 0; writer < 4; writer++ {
		workers.Add(1)
		go func(writer int) {
			defer workers.Done()
			for iteration := 0; iteration < 20; iteration++ {
				data := []byte(fmt.Sprintf(`{"servers":[{"id":"%d-%d"}]}`, writer, iteration))
				if err := store.Write(path, data); err != nil {
					errs <- err
					return
				}
			}
		}(writer)
	}
	for reader := 0; reader < 4; reader++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for iteration := 0; iteration < 20; iteration++ {
				data, err := store.Read(path)
				if err != nil {
					errs <- err
					return
				}
				var parsed map[string]any
				if err := json.Unmarshal(data, &parsed); err != nil {
					errs <- fmt.Errorf("read partial config: %w", err)
					return
				}
			}
		}()
	}
	workers.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
}

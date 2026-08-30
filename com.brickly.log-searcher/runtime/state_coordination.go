package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
)

type configFileStore struct {
	mu sync.RWMutex
}

func newConfigFileStore() *configFileStore {
	return &configFileStore{}
}

func (store *configFileStore) Read(path string) ([]byte, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return os.ReadFile(path)
}

func (store *configFileStore) Write(path string, data []byte) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	temp, err := os.CreateTemp(filepath.Dir(path), ".log-searcher-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Chmod(0644); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

type activeStoredSearch struct {
	cancel context.CancelFunc
}

type storedSearchController struct {
	mu      sync.Mutex
	results *resultStore
	active  map[string]*activeStoredSearch
}

func newStoredSearchController(results *resultStore) *storedSearchController {
	return &storedSearchController{
		results: results,
		active:  make(map[string]*activeStoredSearch),
	}
}

func (controller *storedSearchController) Start(
	serverID string,
	tabs []string,
	cancel context.CancelFunc,
) (string, *activeStoredSearch) {
	entry := &activeStoredSearch{cancel: cancel}
	controller.mu.Lock()
	previous := controller.active[serverID]
	controller.active[serverID] = entry
	runID := controller.results.StartRun(serverID, tabs)
	controller.mu.Unlock()

	if previous != nil {
		previous.cancel()
	}
	return runID, entry
}

func (controller *storedSearchController) Finish(serverID string, entry *activeStoredSearch) {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.active[serverID] == entry {
		delete(controller.active, serverID)
	}
}

func (controller *storedSearchController) Clear(serverID string) {
	controller.mu.Lock()
	entry := controller.active[serverID]
	delete(controller.active, serverID)
	controller.results.ClearServer(serverID)
	controller.mu.Unlock()

	if entry != nil {
		entry.cancel()
	}
}

var (
	configFiles    = newConfigFileStore()
	storedSearches = newStoredSearchController(searchResults)
)

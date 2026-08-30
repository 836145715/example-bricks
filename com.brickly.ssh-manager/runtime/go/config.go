package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type configStore struct {
	mu       sync.Mutex
	pathFn   func() (string, error)
	readFile func(string) ([]byte, error)
	writeFn  func(string, []byte) error
}

func newConfigStore() *configStore {
	return &configStore{
		pathFn:   defaultConfigPath,
		readFile: os.ReadFile,
		writeFn: func(path string, data []byte) error {
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return err
			}
			return os.WriteFile(path, data, 0o600)
		},
	}
}

func defaultConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".brickly", "ssh-manager.json"), nil
}

func (s *configStore) Load() (hostStore, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *configStore) loadLocked() (hostStore, error) {
	path, err := s.pathFn()
	if err != nil {
		return hostStore{}, err
	}
	data, err := s.readFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return hostStore{Hosts: []Host{}}, nil
		}
		return hostStore{}, err
	}
	var store hostStore
	if err := json.Unmarshal(data, &store); err != nil {
		return hostStore{}, err
	}
	normalized := make([]Host, 0, len(store.Hosts))
	for _, host := range store.Hosts {
		host = normalizeHost(host)
		if err := validateHost(host); err != nil {
			continue
		}
		normalized = append(normalized, host)
	}
	store.Hosts = normalized
	return store, nil
}

func (s *configStore) Save(store hostStore) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(store)
}

func (s *configStore) saveLocked(store hostStore) error {
	if store.Hosts == nil {
		store.Hosts = []Host{}
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	path, err := s.pathFn()
	if err != nil {
		return err
	}
	return s.writeFn(path, data)
}

func (s *configStore) List() ([]Host, error) {
	store, err := s.Load()
	if err != nil {
		return nil, err
	}
	return store.Hosts, nil
}

func (s *configStore) Upsert(host Host) (Host, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	store, err := s.loadLocked()
	if err != nil {
		return Host{}, err
	}
	store.Hosts = upsertHost(store.Hosts, host)
	if err := s.saveLocked(store); err != nil {
		return Host{}, err
	}
	return host, nil
}

func (s *configStore) Delete(hostID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	store, err := s.loadLocked()
	if err != nil {
		return false, err
	}
	next, found := removeHost(store.Hosts, hostID)
	if !found {
		return false, nil
	}
	store.Hosts = next
	return true, s.saveLocked(store)
}

func (s *configStore) Get(hostID string) (Host, bool, error) {
	store, err := s.Load()
	if err != nil {
		return Host{}, false, err
	}
	host, ok := findHost(store.Hosts, hostID)
	return host, ok, nil
}

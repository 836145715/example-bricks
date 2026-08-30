package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestConfigStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store := newConfigStore()
	store.pathFn = func() (string, error) {
		return filepath.Join(dir, "ssh-manager.json"), nil
	}

	host := normalizeHost(Host{
		ID:       "h1",
		Name:     "跳板旁路",
		Host:     "ops.internal",
		User:     "deploy",
		AuthType: authPassword,
		Password: "secret",
		Group:    "生产",
		Tags:     []string{"linux"},
	})
	saved, err := store.Upsert(host)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID != "h1" {
		t.Fatalf("unexpected id %s", saved.ID)
	}

	listed, err := store.List()
	if err != nil || len(listed) != 1 || listed[0].Password != "secret" {
		t.Fatalf("list mismatch: %#v %v", listed, err)
	}

	got, ok, err := store.Get("h1")
	if err != nil || !ok || got.Host != "ops.internal" {
		t.Fatalf("get mismatch: %#v ok=%v err=%v", got, ok, err)
	}

	found, err := store.Delete("h1")
	if err != nil || !found {
		t.Fatalf("delete failed: found=%v err=%v", found, err)
	}
	listed, err = store.List()
	if err != nil || len(listed) != 0 {
		t.Fatalf("expected empty list, got %#v", listed)
	}

	info, err := os.Stat(filepath.Join(dir, "ssh-manager.json"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("config file should be owner-only, mode=%v", info.Mode())
	}
}

func TestConfigStoreSkipsInvalidRecords(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ssh-manager.json")
	if err := os.WriteFile(path, []byte(`{"hosts":[{"id":"bad"},{"id":"ok","host":"a.example","user":"u","authType":"password","password":"p","port":22}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := newConfigStore()
	store.pathFn = func() (string, error) { return path, nil }
	listed, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != "ok" {
		t.Fatalf("expected only valid host, got %#v", listed)
	}
}

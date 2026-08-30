package main

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestParsePrivateKeyRequiresPassphrase(t *testing.T) {
	_, err := parsePrivateKey(Host{
		AuthType: authKey,
		KeyText:  "not-a-key",
	})
	if err == nil {
		t.Fatal("expected parse error")
	}
	if !strings.Contains(err.Error(), "failed to parse private key") && !strings.Contains(err.Error(), "ssh:") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildAuthMethodsPassword(t *testing.T) {
	methods, err := buildAuthMethods(Host{AuthType: authPassword, Password: "p@ss"})
	if err != nil {
		t.Fatal(err)
	}
	if len(methods) != 1 {
		t.Fatalf("expected one auth method, got %d", len(methods))
	}
}

func TestReadPrivateKeyBytesPrefersText(t *testing.T) {
	data, err := readPrivateKeyBytes(Host{KeyText: "KEYDATA", KeyPath: "ignored"})
	if err != nil || string(data) != "KEYDATA" {
		t.Fatalf("key text should win: %q %v", data, err)
	}
}

func TestResolveHostUsesInlineOrStore(t *testing.T) {
	store := newConfigStore()
	path := filepath.Join(t.TempDir(), "ssh-manager.json")
	store.pathFn = func() (string, error) {
		return path, nil
	}
	saved := normalizeHost(Host{
		ID:       "h1",
		Host:     "stored.example",
		User:     "u",
		AuthType: authPassword,
		Password: "p",
	})
	if _, err := store.Upsert(saved); err != nil {
		t.Fatal(err)
	}

	got, err := resolveHost(store, "h1", nil)
	if err != nil || got.Host != "stored.example" {
		t.Fatalf("store lookup failed: %#v %v", got, err)
	}

	inline, err := resolveHost(store, "", map[string]any{
		"host":     "inline.example",
		"user":     "root",
		"authType": "password",
		"password": "x",
	})
	if err != nil || inline.Host != "inline.example" {
		t.Fatalf("inline host failed: %#v %v", inline, err)
	}

	if _, err := resolveHost(store, "missing", nil); err == nil {
		t.Fatal("expected not found")
	}
}

func TestClampExecTimeout(t *testing.T) {
	if clampExecTimeout(0) != defaultExecTimeout {
		t.Fatal("default timeout")
	}
	if clampExecTimeout(999999) != maxExecTimeout {
		t.Fatal("max timeout")
	}
}

func TestPassphraseMissingErrorMessage(t *testing.T) {
	err := &ssh.PassphraseMissingError{}
	if err.Error() == "" {
		t.Fatal("passphrase error should have message")
	}
}

package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeRemotePathRejectsWindowsAndNUL(t *testing.T) {
	if _, err := normalizeRemotePath("C:\\temp\\a.txt"); err == nil {
		t.Fatal("expected windows path rejected")
	}
	if _, err := normalizeRemotePath("ok\x00path"); err == nil {
		t.Fatal("expected NUL rejected")
	}
	got, err := normalizeRemotePath("  /home/alice  ")
	if err != nil || got != "/home/alice" {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestJoinAndBaseRemote(t *testing.T) {
	if joinRemote("/home/alice", "app.log") != "/home/alice/app.log" {
		t.Fatal(joinRemote("/home/alice", "app.log"))
	}
	if joinRemote("/", "etc") != "/etc" {
		t.Fatal(joinRemote("/", "etc"))
	}
	if remoteBase("/home/alice/app.log") != "app.log" {
		t.Fatal(remoteBase("/home/alice/app.log"))
	}
}

func TestConfineLocalRejectsEscape(t *testing.T) {
	dir := t.TempDir()
	if _, err := confineLocal(dir, "..\\secret.txt"); err == nil {
		t.Fatal("expected escape rejected")
	}
	if _, err := confineLocal(dir, "../secret.txt"); err == nil {
		t.Fatal("expected slash escape rejected")
	}
	got, err := confineLocal(dir, "ok.txt")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(got) != filepath.Clean(dir) {
		t.Fatalf("dest %s not under %s", got, dir)
	}
}

func TestRequireAbsoluteLocal(t *testing.T) {
	if _, err := requireAbsoluteLocal("relative.txt"); err == nil || !strings.Contains(err.Error(), "absolute") {
		t.Fatalf("expected absolute path error, got %v", err)
	}
}

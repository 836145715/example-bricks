package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListRemoteEmptyPathUsesHome(t *testing.T) {
	remote := newMappedRemote(t.TempDir(), "/home/alice")
	if err := remote.MkdirAll("/home/alice"); err != nil {
		t.Fatal(err)
	}
	file, err := remote.Create("/home/alice/app.log", false)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("hello"))
	_ = file.Close()

	listed, err := listRemote(remote, "")
	if err != nil {
		t.Fatal(err)
	}
	if listed.Path != "/home/alice" {
		t.Fatalf("home path: %s", listed.Path)
	}
	if len(listed.Entries) != 1 || listed.Entries[0]["name"] != "app.log" {
		t.Fatalf("entries: %#v", listed.Entries)
	}
	if listed.Entries[0]["kind"] != "file" || listed.Entries[0]["size"].(int64) != 5 {
		t.Fatalf("entry: %#v", listed.Entries[0])
	}
}

func TestUploadThenListSameSize(t *testing.T) {
	localDir := t.TempDir()
	remoteRoot := t.TempDir()
	localFile := filepath.Join(localDir, "note.txt")
	if err := os.WriteFile(localFile, []byte("payload-42"), 0o644); err != nil {
		t.Fatal(err)
	}
	remote := newMappedRemote(remoteRoot, "/home/alice")
	if err := remote.MkdirAll("/home/alice"); err != nil {
		t.Fatal(err)
	}

	result, err := uploadLocal(context.Background(), remote, localFile, "", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemotePath != "/home/alice/note.txt" || result.Bytes != 10 {
		t.Fatalf("result: %#v", result)
	}
	listed, err := listRemote(remote, "")
	if err != nil {
		t.Fatal(err)
	}
	if listed.Entries[0]["name"] != "note.txt" || listed.Entries[0]["size"].(int64) != 10 {
		t.Fatalf("listed: %#v", listed.Entries)
	}
}

func TestUploadDoesNotOverwriteUnlessAsked(t *testing.T) {
	localDir := t.TempDir()
	localFile := filepath.Join(localDir, "note.txt")
	if err := os.WriteFile(localFile, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	remote := newMappedRemote(t.TempDir(), "/home/alice")
	_ = remote.MkdirAll("/home/alice")
	if _, err := uploadLocal(context.Background(), remote, localFile, "", false, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(localFile, []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := uploadLocal(context.Background(), remote, localFile, "", false, nil)
	if err == nil || !strings.Contains(err.Error(), "远端已存在") {
		t.Fatalf("expected exists error, got %v", err)
	}
	if _, err := uploadLocal(context.Background(), remote, localFile, "", true, nil); err != nil {
		t.Fatal(err)
	}
	reader, err := remote.Open("/home/alice/note.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	buf := make([]byte, 8)
	n, _ := reader.Read(buf)
	if string(buf[:n]) != "v2" {
		t.Fatalf("overwrite content %q", buf[:n])
	}
}

func TestUploadDirectoryKeepsRelativeLayout(t *testing.T) {
	localRoot := t.TempDir()
	tree := filepath.Join(localRoot, "bundle")
	if err := os.MkdirAll(filepath.Join(tree, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "a.txt"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "nested", "b.txt"), []byte("BB"), 0o644); err != nil {
		t.Fatal(err)
	}
	remote := newMappedRemote(t.TempDir(), "/home/alice")
	_ = remote.MkdirAll("/home/alice")
	if _, err := uploadLocal(context.Background(), remote, tree, "", false, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := remote.Stat("/home/alice/bundle/a.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := remote.Stat("/home/alice/bundle/nested/b.txt"); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadStaysInsideLocalDir(t *testing.T) {
	remote := newMappedRemote(t.TempDir(), "/home/alice")
	_ = remote.MkdirAll("/home/alice")
	file, _ := remote.Create("/home/alice/ok.txt", false)
	_, _ = file.Write([]byte("x"))
	_ = file.Close()

	outside := t.TempDir()
	localDir := filepath.Join(t.TempDir(), "dl")
	_, err := downloadRemote(context.Background(), remote, "/home/alice/../../../"+filepath.Base(outside), localDir, false, nil)
	if err == nil {
		t.Fatal("expected confined download to fail")
	}

	result, err := downloadRemote(context.Background(), remote, "/home/alice/ok.txt", localDir, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(localDir, result.LocalPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		t.Fatalf("download escaped: %s %v", result.LocalPath, err)
	}
}

func TestUploadProgressEmitsStartMidAndFinish(t *testing.T) {
	localFile := filepath.Join(t.TempDir(), "big.bin")
	payload := bytes.Repeat([]byte("n"), 300*1024)
	if err := os.WriteFile(localFile, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	remote := newMappedRemote(t.TempDir(), "/home/alice")
	_ = remote.MkdirAll("/home/alice")

	var events []transferProgress
	emitter := newProgressEmitter(func(item transferProgress) {
		events = append(events, item)
	})
	if _, err := uploadLocal(context.Background(), remote, localFile, "", false, emitter); err != nil {
		t.Fatal(err)
	}
	if len(events) < 3 {
		t.Fatalf("expected start/mid/finish, got %d", len(events))
	}
	var sawStart, sawMid, sawFinish bool
	for _, event := range events {
		raw, _ := json.Marshal(event)
		if bytes.Contains(raw, []byte("password")) || bytes.Contains(raw, []byte("passphrase")) {
			t.Fatalf("progress leaked secret: %s", raw)
		}
		if event.Phase == "upload" && event.FileBytes == 0 && event.FileIndex == 1 {
			sawStart = true
		}
		if event.Phase == "upload" && event.FileBytes > 0 && event.FileBytes < event.FileTotalBytes {
			sawMid = true
		}
		if event.Percent != nil && *event.Percent == 100 {
			sawFinish = true
		}
	}
	if !sawStart || !sawMid || !sawFinish {
		t.Fatalf("progress flags start=%v mid=%v finish=%v events=%d", sawStart, sawMid, sawFinish, len(events))
	}
}

func TestSFTPErrorsDoNotIncludeSecrets(t *testing.T) {
	err := newExistsError("/home/alice/app.log")
	if strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "BEGIN") {
		t.Fatal(err)
	}
	if !strings.Contains(err.Error(), "app.log") {
		t.Fatal(err)
	}
}

func TestSessionHubReturnsClient(t *testing.T) {
	hub := newSessionHub()
	if _, ok := hub.client("missing"); ok {
		t.Fatal("missing client should be false")
	}
}

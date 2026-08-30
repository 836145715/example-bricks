package main

import (
	"bytes"
	"testing"
)

func TestPtyScannerExtractsPidAndStrips(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("hello\x1b]7331;Pid=4242\x07world"))
	if result.pid != 4242 {
		t.Fatalf("pid=%d", result.pid)
	}
	if string(result.visible) != "helloworld" {
		t.Fatalf("visible=%q", result.visible)
	}
}

func TestPtyScannerPidAcrossChunks(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("pre\x1b]7331;Pid="))
	if result.pid != 0 || string(result.visible) != "pre" {
		t.Fatalf("partial: visible=%q pid=%d", result.visible, result.pid)
	}
	result = s.push([]byte("99\x07post"))
	if result.pid != 99 || string(result.visible) != "post" {
		t.Fatalf("second: visible=%q pid=%d", result.visible, result.pid)
	}
}

func TestPtyScannerIgnoresSecondPid(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("\x1b]7331;Pid=1\x07\x1b]7331;Pid=2\x07"))
	if result.pid != 1 {
		t.Fatalf("pid=%d", result.pid)
	}
	result = s.push([]byte("\x1b]7331;Pid=3\x07"))
	if result.pid != 0 || s.pid != 1 {
		t.Fatalf("locked pid=%d next=%d", s.pid, result.pid)
	}
}

func TestPtyScannerPidSTTerminator(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("\x1b]7331;Pid=7\x1b\\ok"))
	if result.pid != 7 || string(result.visible) != "ok" {
		t.Fatalf("pid=%d visible=%q", result.pid, result.visible)
	}
}

func TestPtyScannerOSC7FileURL(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("a\x1b]7;file://host/home/alice\x07b"))
	if result.cwd != "/home/alice" {
		t.Fatalf("cwd=%q", result.cwd)
	}
	if string(result.visible) != "ab" {
		t.Fatalf("visible=%q", result.visible)
	}
}

func TestPtyScannerOSC7LocalFileAndRawPath(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("\x1b]7;file:///tmp/work\x1b\\"))
	if result.cwd != "/tmp/work" {
		t.Fatalf("file url cwd=%q", result.cwd)
	}
	result = s.push([]byte("\x1b]7;/var/log\x07"))
	if result.cwd != "/var/log" {
		t.Fatalf("raw cwd=%q", result.cwd)
	}
}

func TestPtyScannerOSC7UnescapesPath(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("\x1b]7;file://host/home/alice/My%20Docs\x07"))
	if result.cwd != "/home/alice/My Docs" {
		t.Fatalf("cwd=%q", result.cwd)
	}
}

func TestPtyScannerOSC7AcrossChunks(t *testing.T) {
	s := &ptyScanner{}
	result := s.push([]byte("x\x1b]7;file://h"))
	if result.cwd != "" || string(result.visible) != "x" {
		t.Fatalf("partial: cwd=%q visible=%q", result.cwd, result.visible)
	}
	result = s.push([]byte("ost/opt/app\x07y"))
	if result.cwd != "/opt/app" || string(result.visible) != "y" {
		t.Fatalf("second: cwd=%q visible=%q", result.cwd, result.visible)
	}
}

func TestPtyScannerPassesUnknownOSCAndCSI(t *testing.T) {
	s := &ptyScanner{}
	raw := []byte("\x1b]0;title\x07\x1b[31mred")
	result := s.push(raw)
	if string(result.visible) != string(raw) {
		t.Fatalf("visible=%q", result.visible)
	}
}

func TestParseOSC7RejectsInvalid(t *testing.T) {
	if parseOSC7("") != "" || parseOSC7("file://host") != "" || parseOSC7("home") != "" {
		t.Fatal("expected empty for invalid OSC 7")
	}
}

func TestValidRemoteCwd(t *testing.T) {
	if !validRemoteCwd("/home/alice") {
		t.Fatal("expected unix path")
	}
	if validRemoteCwd("") || validRemoteCwd("home") || validRemoteCwd("/tmp\n") {
		t.Fatal("rejected invalid")
	}
	if validRemoteCwd("/tmp (deleted)") {
		t.Fatal("deleted cwd")
	}
}

func TestProcCwdPath(t *testing.T) {
	if procCwdPath(4242) != "/proc/4242/cwd" {
		t.Fatalf("path=%s", procCwdPath(4242))
	}
}

func TestShellBootCommandAnnouncesPID(t *testing.T) {
	if !bytes.Contains([]byte(shellBootCommand), []byte("7331;Pid=")) {
		t.Fatal("missing OSC")
	}
	if !bytes.Contains([]byte(shellBootCommand), []byte("$$")) {
		t.Fatal("missing pid")
	}
}

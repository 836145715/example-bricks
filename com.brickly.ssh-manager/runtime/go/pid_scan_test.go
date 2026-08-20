package main

import (
	"bytes"
	"testing"
)

func TestPidScannerExtractsAndStrips(t *testing.T) {
	s := &pidScanner{}
	visible, pid := s.push([]byte("hello\x1b]7331;Pid=4242\x07world"))
	if pid != 4242 {
		t.Fatalf("pid=%d", pid)
	}
	if string(visible) != "helloworld" {
		t.Fatalf("visible=%q", visible)
	}
}

func TestPidScannerAcrossChunks(t *testing.T) {
	s := &pidScanner{}
	visible, pid := s.push([]byte("pre\x1b]7331;Pid="))
	if pid != 0 || string(visible) != "pre" {
		t.Fatalf("partial: visible=%q pid=%d", visible, pid)
	}
	visible, pid = s.push([]byte("99\x07post"))
	if pid != 99 || string(visible) != "post" {
		t.Fatalf("second: visible=%q pid=%d", visible, pid)
	}
}

func TestPidScannerIgnoresSecondPid(t *testing.T) {
	s := &pidScanner{}
	_, pid := s.push([]byte("\x1b]7331;Pid=1\x07\x1b]7331;Pid=2\x07"))
	if pid != 1 {
		t.Fatalf("pid=%d", pid)
	}
	_, pid = s.push([]byte("\x1b]7331;Pid=3\x07"))
	if pid != 0 || s.pid != 1 {
		t.Fatalf("locked pid=%d next=%d", s.pid, pid)
	}
}

func TestPidScannerSTTerminator(t *testing.T) {
	s := &pidScanner{}
	_, pid := s.push([]byte("\x1b]7331;Pid=7\x1b\\ok"))
	if pid != 7 {
		t.Fatalf("pid=%d", pid)
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

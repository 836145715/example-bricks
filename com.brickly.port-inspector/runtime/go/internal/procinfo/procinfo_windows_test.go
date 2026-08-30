//go:build windows

package procinfo

import (
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestStopSelfRejected(t *testing.T) {
	_, err := Stop(uint32(os.Getpid()), true)
	if err != ErrSelf {
		t.Fatalf("expected ErrSelf, got %v", err)
	}
}

func TestGetDetailsSelf(t *testing.T) {
	d, err := GetDetails(uint32(os.Getpid()))
	if err != nil {
		t.Fatalf("GetDetails: %v", err)
	}
	if d.PID != uint32(os.Getpid()) {
		t.Fatalf("pid mismatch: %d", d.PID)
	}
	if d.ProcessName == nil && d.ExecutablePath == nil {
		t.Fatal("expected process name or path")
	}
}

func TestStopChildProcessAPI(t *testing.T) {
	// Use a normal user process (ping) rather than the test binary itself.
	cmd := exec.Command("ping", "-n", "9999", "127.0.0.1")
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot start ping helper: %v", err)
	}
	pid := uint32(cmd.Process.Pid)
	defer func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	time.Sleep(80 * time.Millisecond)
	result, err := Stop(pid, true)
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if !result.OK || result.Method != "api" {
		t.Fatalf("unexpected result: %+v", result)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("helper did not exit after TerminateProcess")
	}

	result2, err := Stop(pid, true)
	if err != nil {
		t.Fatalf("second Stop: %v", err)
	}
	if !result2.OK || !result2.AlreadyExited {
		t.Fatalf("expected alreadyExited second stop, got %+v", result2)
	}
}

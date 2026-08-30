//go:build darwin

package procinfo

import (
	"errors"
	"os"
	"os/exec"
	"testing"
)

func TestDarwinProcessIdentityAndDetails(t *testing.T) {
	pid := uint32(os.Getpid())
	snapshot, err := darwinProcessSnapshot(pid)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.StartKey == "" || snapshot.ProcessName == "" || snapshot.StartedAt == "" {
		t.Fatalf("incomplete snapshot: %#v", snapshot)
	}

	details, err := GetDetails(pid, snapshot.StartKey)
	if err != nil {
		t.Fatal(err)
	}
	if details.PID != pid || details.StartKey != snapshot.StartKey {
		t.Fatalf("details identity mismatch: %#v", details)
	}
}

func TestDarwinExitedProcessIsNotFound(t *testing.T) {
	cmd := exec.Command("/bin/sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	snapshot, err := darwinProcessSnapshot(uint32(cmd.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()

	if _, err := darwinProcessSnapshot(uint32(cmd.Process.Pid)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("snapshot error=%v", err)
	}
	result, err := Stop(uint32(cmd.Process.Pid), snapshot.StartKey, false)
	if err != nil {
		t.Fatal(err)
	}
	if !result.AlreadyExited {
		t.Fatalf("stop result=%#v", result)
	}
}

func TestDarwinStopsVerifiedProcess(t *testing.T) {
	cmd := exec.Command("/bin/sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})
	snapshot, err := darwinProcessSnapshot(uint32(cmd.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	result, err := Stop(uint32(cmd.Process.Pid), snapshot.StartKey, false)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK || result.AlreadyExited {
		t.Fatalf("stop result=%#v", result)
	}
}

func TestDarwinRejectsReusedAndSelfProcess(t *testing.T) {
	pid := uint32(os.Getpid())
	if err := verifyDarwinIdentity(pid, "1"); !errors.Is(err, ErrReused) {
		t.Fatalf("identity error=%v", err)
	}
	if _, err := Stop(pid, "1", false); !errors.Is(err, ErrSelf) {
		t.Fatalf("self stop error=%v", err)
	}
}

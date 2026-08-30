//go:build darwin

package procinfo

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func PlatformName() string { return "macos" }

func SnapshotOf(pid uint32) Snapshot {
	if pid == 0 {
		return Snapshot{}
	}
	snap := Snapshot{
		StartedAt: startedAtOf(pid),
	}
	if path := executablePath(pid); path != "" {
		snap.ExecutablePath = path
		snap.ProcessName = filepath.Base(path)
	} else if name := processComm(pid); name != "" {
		snap.ProcessName = name
	}
	return snap
}

func GetDetails(pid uint32) (Details, error) {
	if pid == 0 {
		return Details{}, ErrInvalidInput
	}
	if !processExists(pid) {
		return Details{}, ErrNotFound
	}
	snap := SnapshotOf(pid)
	parent := parentPID(pid)
	return Details{
		OK:               true,
		Platform:         PlatformName(),
		PID:              pid,
		ParentPID:        parent,
		ProcessName:      stringPtr(snap.ProcessName),
		ExecutablePath:   stringPtr(snap.ExecutablePath),
		CommandLine:      readCommandLine(pid),
		WorkingDirectory: nil,
		User:             nil,
		State:            nil,
		StartedAt:        stringPtr(snap.StartedAt),
		Elapsed:          nil,
		InspectedAt:      time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func Stop(pid uint32, force bool) (StopResult, error) {
	if pid == 0 {
		return StopResult{}, ErrInvalidInput
	}
	if int(pid) == syscall.Getpid() {
		return StopResult{}, ErrSelf
	}
	if !processExists(pid) {
		return StopResult{
			OK:            true,
			PID:           pid,
			AlreadyExited: true,
			Force:         force,
			Method:        "api",
			Platform:      PlatformName(),
			KilledAt:      time.Now().UTC().Format(time.RFC3339Nano),
		}, nil
	}
	name := SnapshotOf(pid).ProcessName
	sig := syscall.SIGTERM
	if force {
		sig = syscall.SIGKILL
	}
	if err := syscall.Kill(int(pid), sig); err != nil {
		if err == syscall.ESRCH {
			return StopResult{
				OK:            true,
				PID:           pid,
				ProcessName:   name,
				AlreadyExited: true,
				Force:         force,
				Method:        "api",
				Platform:      PlatformName(),
				KilledAt:      time.Now().UTC().Format(time.RFC3339Nano),
			}, nil
		}
		if err == syscall.EPERM {
			return StopResult{}, fmt.Errorf("%w: kill pid %d", ErrAccess, pid)
		}
		return StopResult{}, fmt.Errorf("%w: kill pid %d: %v", ErrTerminate, pid, err)
	}
	return StopResult{
		OK:          true,
		PID:         pid,
		ProcessName: name,
		Force:       force,
		Method:      "api",
		Platform:    PlatformName(),
		KilledAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func processExists(pid uint32) bool {
	err := syscall.Kill(int(pid), 0)
	return err == nil || err == syscall.EPERM
}

func startedAtOf(pid uint32) string {
	out, err := exec.Command("ps", "-p", strconv.FormatUint(uint64(pid), 10), "-o", "lstart=").Output()
	if err != nil {
		return ""
	}
	return strings.Join(strings.Fields(strings.TrimSpace(string(out))), " ")
}

func processComm(pid uint32) string {
	out, err := exec.Command("ps", "-p", strconv.FormatUint(uint64(pid), 10), "-o", "comm=").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func executablePath(pid uint32) string {
	out, err := exec.Command("lsof", "-a", "-p", strconv.FormatUint(uint64(pid), 10), "-d", "txt", "-Fn").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "n") {
			path := strings.TrimSpace(line[1:])
			if path != "" {
				return path
			}
		}
	}
	return ""
}

func parentPID(pid uint32) *uint32 {
	out, err := exec.Command("ps", "-p", strconv.FormatUint(uint64(pid), 10), "-o", "ppid=").Output()
	if err != nil {
		return nil
	}
	n, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 32)
	if err != nil || n == 0 {
		return nil
	}
	v := uint32(n)
	return &v
}

func readCommandLine(pid uint32) *string {
	out, err := exec.Command("ps", "-p", strconv.FormatUint(uint64(pid), 10), "-o", "args=").Output()
	if err != nil {
		return nil
	}
	text := strings.TrimSpace(string(out))
	if text == "" {
		return nil
	}
	return &text
}

func stringPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

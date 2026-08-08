//go:build darwin

package procinfo

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type darwinSnapshot struct {
	StartKey    string
	ProcessName string
	ParentPID   uint32
	SessionID   uint32
	User        string
	StartedAt   string
}

func GetDetails(pid uint32, startKey string) (Details, error) {
	snapshot, err := verifiedDarwinSnapshot(pid, startKey)
	if err != nil {
		return Details{}, err
	}
	return Details{
		PID:            pid,
		StartKey:       snapshot.StartKey,
		ProcessName:    snapshot.ProcessName,
		ExecutablePath: darwinExecutablePath(pid),
		CommandLine:    darwinCommandLine(pid),
		User:           snapshot.User,
		ParentPID:      snapshot.ParentPID,
		SessionID:      snapshot.SessionID,
		StartedAt:      snapshot.StartedAt,
		InspectedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func Stop(pid uint32, startKey string, force bool) (StopResult, error) {
	if pid == uint32(os.Getpid()) {
		return StopResult{}, ErrSelf
	}
	snapshot, err := verifiedDarwinSnapshot(pid, startKey)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return StopResult{
				OK:            true,
				PID:           pid,
				StartKey:      startKey,
				Force:         force,
				AlreadyExited: true,
				StoppedAt:     time.Now().UTC().Format(time.RFC3339Nano),
			}, nil
		}
		return StopResult{}, err
	}
	signal := syscall.SIGTERM
	if force {
		signal = syscall.SIGKILL
	}
	if err := unix.Kill(int(pid), signal); err != nil {
		if errors.Is(err, unix.ESRCH) {
			return StopResult{
				OK:            true,
				PID:           pid,
				StartKey:      startKey,
				ProcessName:   snapshot.ProcessName,
				Force:         force,
				AlreadyExited: true,
				StoppedAt:     time.Now().UTC().Format(time.RFC3339Nano),
			}, nil
		}
		return StopResult{}, fmt.Errorf("%w: signal pid %d: %v", ErrTerminate, pid, err)
	}
	return StopResult{
		OK:          true,
		PID:         pid,
		StartKey:    startKey,
		ProcessName: snapshot.ProcessName,
		Force:       force,
		StoppedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func verifyDarwinIdentity(pid uint32, startKey string) error {
	_, err := verifiedDarwinSnapshot(pid, startKey)
	return err
}

func verifiedDarwinSnapshot(pid uint32, startKey string) (darwinSnapshot, error) {
	want, err := strconv.ParseInt(strings.TrimSpace(startKey), 10, 64)
	if pid == 0 || err != nil || want <= 0 {
		return darwinSnapshot{}, fmt.Errorf("%w: process identity", ErrInvalidInput)
	}
	snapshot, err := darwinProcessSnapshot(pid)
	if err != nil {
		return darwinSnapshot{}, err
	}
	if snapshot.StartKey != strconv.FormatInt(want, 10) {
		return darwinSnapshot{}, ErrReused
	}
	return snapshot, nil
}

func darwinProcessSnapshot(pid uint32) (darwinSnapshot, error) {
	if pid == 0 {
		return darwinSnapshot{}, ErrInvalidInput
	}
	kinfo, err := unix.SysctlKinfoProc("kern.proc.pid", int(pid))
	if err != nil {
		switch {
		case errors.Is(err, unix.ESRCH), errors.Is(err, unix.ENOENT):
			return darwinSnapshot{}, ErrNotFound
		case errors.Is(err, unix.EIO):
			if existsErr := unix.Kill(int(pid), 0); errors.Is(existsErr, unix.ESRCH) {
				return darwinSnapshot{}, ErrNotFound
			}
			return darwinSnapshot{}, fmt.Errorf("%w: pid %d: %v", ErrDetails, pid, err)
		case errors.Is(err, unix.EPERM), errors.Is(err, unix.EACCES):
			return darwinSnapshot{}, fmt.Errorf("%w: pid %d: %v", ErrDetails, pid, err)
		default:
			return darwinSnapshot{}, fmt.Errorf("%w: pid %d: %v", ErrDetails, pid, err)
		}
	}
	started := kinfo.Proc.P_starttime
	startMicros := started.Sec*1_000_000 + int64(started.Usec)
	name := darwinComm(kinfo.Proc.P_comm[:])
	if name == "" {
		name = fmt.Sprintf("pid-%d", pid)
	}
	sessionID := uint32(0)
	if sid, sidErr := unix.Getsid(int(pid)); sidErr == nil && sid >= 0 {
		sessionID = uint32(sid)
	}
	userName := ""
	if account, lookupErr := user.LookupId(strconv.FormatUint(uint64(kinfo.Eproc.Ucred.Uid), 10)); lookupErr == nil {
		userName = account.Username
	}
	return darwinSnapshot{
		StartKey:    strconv.FormatInt(startMicros, 10),
		ProcessName: name,
		ParentPID:   uint32(kinfo.Eproc.Ppid),
		SessionID:   sessionID,
		User:        userName,
		StartedAt:   time.Unix(started.Sec, int64(started.Usec)*1_000).UTC().Format(time.RFC3339Nano),
	}, nil
}

func darwinComm(raw []byte) string {
	bytes := make([]byte, 0, len(raw))
	for _, value := range raw {
		if value == 0 {
			break
		}
		bytes = append(bytes, value)
	}
	return string(bytes)
}

func darwinCommandLine(pid uint32) string {
	out, err := exec.Command("/bin/ps", "-ww", "-p", strconv.FormatUint(uint64(pid), 10), "-o", "command=").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func darwinExecutablePath(pid uint32) string {
	out, err := exec.Command(lsofExecutable, "-a", "-p", strconv.FormatUint(uint64(pid), 10), "-d", "txt", "-Fn").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "n/") {
			return strings.TrimPrefix(line, "n")
		}
	}
	return ""
}

const lsofExecutable = "/usr/sbin/lsof"

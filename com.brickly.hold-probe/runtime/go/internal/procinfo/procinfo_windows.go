//go:build windows

package procinfo

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

func GetDetails(pid uint32, startKey string) (Details, error) {
	if err := verifyIdentity(pid, startKey); err != nil {
		return Details{}, err
	}

	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		if err == windows.ERROR_INVALID_PARAMETER {
			return Details{}, ErrNotFound
		}
		return Details{}, fmt.Errorf("%w: open process: %v", ErrDetails, err)
	}
	defer windows.CloseHandle(h)

	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &creation, &exit, &kernel, &user); err != nil {
		return Details{}, fmt.Errorf("%w: times: %v", ErrDetails, err)
	}
	key := filetimeUint64(creation)

	exe := ""
	var buf [32768]uint16
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err == nil {
		exe = windows.UTF16ToString(buf[:size])
	}
	name := filepath.Base(exe)
	if name == "" || name == "." {
		name = fmt.Sprintf("pid-%d", pid)
	}

	extra := queryCIM(pid)

	return Details{
		PID:            pid,
		StartKey:       strconv.FormatUint(key, 10),
		ProcessName:    name,
		ExecutablePath: exe,
		CommandLine:    extra.CommandLine,
		User:           extra.User,
		ParentPID:      extra.ParentPID,
		SessionID:      extra.SessionID,
		StartedAt:      filetimeRFC3339(key),
		InspectedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func Stop(pid uint32, startKey string, force bool) (StopResult, error) {
	if pid == windows.GetCurrentProcessId() {
		return StopResult{}, ErrSelf
	}
	if err := verifyIdentity(pid, startKey); err != nil {
		if err == ErrNotFound {
			return StopResult{
				OK:            true,
				PID:           pid,
				StartKey:      startKey,
				AlreadyExited: true,
				Force:         force,
				StoppedAt:     time.Now().UTC().Format(time.RFC3339Nano),
			}, nil
		}
		return StopResult{}, err
	}

	name := processName(pid)
	args := []string{"/PID", strconv.FormatUint(uint64(pid), 10)}
	if force {
		args = append(args, "/F")
	}
	cmd := exec.Command("taskkill.exe", args...)
	cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Re-check if already gone.
		if verifyIdentity(pid, startKey) == ErrNotFound {
			return StopResult{
				OK:            true,
				PID:           pid,
				StartKey:      startKey,
				ProcessName:   name,
				Force:         force,
				AlreadyExited: true,
				StoppedAt:     time.Now().UTC().Format(time.RFC3339Nano),
			}, nil
		}
		return StopResult{}, fmt.Errorf("%w: %v (%s)", ErrTerminate, err, strings.TrimSpace(string(out)))
	}

	return StopResult{
		OK:          true,
		PID:         pid,
		StartKey:    startKey,
		ProcessName: name,
		Force:       force,
		StoppedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func verifyIdentity(pid uint32, startKey string) error {
	if pid == 0 {
		return ErrInvalidInput
	}
	want, err := strconv.ParseUint(strings.TrimSpace(startKey), 10, 64)
	if err != nil {
		return fmt.Errorf("%w: startKey", ErrInvalidInput)
	}

	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		if err == windows.ERROR_INVALID_PARAMETER {
			return ErrNotFound
		}
		// Access denied still means process may exist — try times may fail.
		return fmt.Errorf("%w: open pid %d: %v", ErrDetails, pid, err)
	}
	defer windows.CloseHandle(h)

	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &creation, &exit, &kernel, &user); err != nil {
		return fmt.Errorf("%w: get times: %v", ErrDetails, err)
	}
	got := filetimeUint64(creation)
	if got != want {
		return ErrReused
	}
	return nil
}

func processName(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return fmt.Sprintf("pid-%d", pid)
	}
	defer windows.CloseHandle(h)
	var buf [windows.MAX_PATH]uint16
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return fmt.Sprintf("pid-%d", pid)
	}
	return filepath.Base(windows.UTF16ToString(buf[:size]))
}

type cimExtra struct {
	CommandLine string
	User        string
	ParentPID   uint32
	SessionID   uint32
}

func queryCIM(pid uint32) cimExtra {
	// Constrained query — pid only, no string interpolation of free-form paths.
	script := fmt.Sprintf(
		`$p=Get-CimInstance Win32_Process -Filter "ProcessId=%d" -ErrorAction SilentlyContinue;`+
			`if(-not $p){ '{}' | ConvertTo-Json -Compress; exit 0 };`+
			`$o=[ordered]@{CommandLine=$p.CommandLine;ParentProcessId=$p.ParentProcessId;SessionId=$p.SessionId;User=$null};`+
			`try{$o.User=$p.GetOwner().User}catch{};`+
			`$o|ConvertTo-Json -Compress`,
		pid,
	)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &windows.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return cimExtra{}
	}
	var raw struct {
		CommandLine     *string `json:"CommandLine"`
		ParentProcessId *uint32 `json:"ParentProcessId"`
		SessionId       *uint32 `json:"SessionId"`
		User            *string `json:"User"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return cimExtra{}
	}
	extra := cimExtra{}
	if raw.CommandLine != nil {
		extra.CommandLine = *raw.CommandLine
	}
	if raw.User != nil {
		extra.User = *raw.User
	}
	if raw.ParentProcessId != nil {
		extra.ParentPID = *raw.ParentProcessId
	}
	if raw.SessionId != nil {
		extra.SessionID = *raw.SessionId
	}
	return extra
}

func filetimeUint64(ft windows.Filetime) uint64 {
	return (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
}

func filetimeRFC3339(value uint64) string {
	const epochDiff = uint64(116444736000000000)
	if value < epochDiff {
		return ""
	}
	return time.Unix(0, int64(value-epochDiff)*100).UTC().Format(time.RFC3339Nano)
}

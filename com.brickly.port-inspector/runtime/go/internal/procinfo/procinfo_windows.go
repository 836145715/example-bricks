//go:build windows

package procinfo

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func PlatformName() string { return "windows" }

func SnapshotOf(pid uint32) Snapshot {
	if pid == 0 {
		return Snapshot{}
	}
	snap := Snapshot{}

	// Prefer Toolhelp name first (works even when OpenProcess is denied).
	if name, ppid, ok := toolhelpName(pid); ok {
		snap.ProcessName = name
		_ = ppid
	}

	h, err := openQuery(pid)
	if err != nil {
		return snap
	}
	defer windows.CloseHandle(h)

	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &creation, &exit, &kernel, &user); err == nil {
		snap.StartedAt = filetimeRFC3339(filetimeUint64(creation))
	}
	var buf [32768]uint16
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err == nil {
		exe := windows.UTF16ToString(buf[:size])
		snap.ExecutablePath = exe
		if base := filepath.Base(exe); base != "" {
			snap.ProcessName = base
		}
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
	var parent *uint32
	if ppid, err := parentPID(pid); err == nil && ppid > 0 {
		parent = &ppid
	}
	return Details{
		OK:               true,
		Platform:         PlatformName(),
		PID:              pid,
		ParentPID:        parent,
		ProcessName:      stringPtr(snap.ProcessName),
		ExecutablePath:   stringPtr(snap.ExecutablePath),
		CommandLine:      stringPtr(processCommandLine(pid)),
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
	if pid == windows.GetCurrentProcessId() {
		return StopResult{}, ErrSelf
	}
	if !processExists(pid) {
		return StopResult{
			OK:            true,
			PID:           pid,
			AlreadyExited: true,
			Force:         true,
			Method:        "api",
			Platform:      PlatformName(),
			KilledAt:      time.Now().UTC().Format(time.RFC3339Nano),
		}, nil
	}
	name := SnapshotOf(pid).ProcessName
	if err := terminateProcess(pid); err != nil {
		if isGone(pid) {
			return StopResult{
				OK:            true,
				PID:           pid,
				ProcessName:   name,
				AlreadyExited: true,
				Force:         true,
				Method:        "api",
				Platform:      PlatformName(),
				KilledAt:      time.Now().UTC().Format(time.RFC3339Nano),
			}, nil
		}
		return StopResult{}, err
	}
	_ = force
	return StopResult{
		OK:          true,
		PID:         pid,
		ProcessName: name,
		Force:       true,
		Method:      "api",
		Platform:    PlatformName(),
		KilledAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

type unicodeStringLocal struct {
	Length        uint16
	MaximumLength uint16
	_             uint32
	Buffer        *uint16
}

func processCommandLine(pid uint32) string {
	h, err := openQuery(pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)

	buf := make([]byte, 4096)
	var retLen uint32
	err = windows.NtQueryInformationProcess(
		h,
		windows.ProcessCommandLineInformation,
		unsafe.Pointer(&buf[0]),
		uint32(len(buf)),
		&retLen,
	)
	if err != nil {
		if retLen > uint32(len(buf)) && retLen < 1<<20 {
			buf = make([]byte, retLen)
			err = windows.NtQueryInformationProcess(
				h,
				windows.ProcessCommandLineInformation,
				unsafe.Pointer(&buf[0]),
				uint32(len(buf)),
				&retLen,
			)
		}
		if err != nil {
			return ""
		}
	}
	if retLen < uint32(unsafe.Sizeof(unicodeStringLocal{})) {
		return ""
	}
	us := (*unicodeStringLocal)(unsafe.Pointer(&buf[0]))
	if us.Length == 0 || us.Buffer == nil {
		return ""
	}
	base := uintptr(unsafe.Pointer(&buf[0]))
	end := base + uintptr(len(buf))
	ptr := uintptr(unsafe.Pointer(us.Buffer))
	need := uintptr(us.Length)
	if ptr < base || ptr+need > end {
		return ""
	}
	n := int(us.Length / 2)
	if n <= 0 || n > 32*1024 {
		return ""
	}
	return windows.UTF16ToString(unsafe.Slice(us.Buffer, n))
}

func terminateProcess(pid uint32) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		if err == windows.ERROR_INVALID_PARAMETER {
			return ErrNotFound
		}
		if err == windows.ERROR_ACCESS_DENIED {
			return fmt.Errorf("%w: open pid %d", ErrAccess, pid)
		}
		return fmt.Errorf("%w: open pid %d: %v", ErrTerminate, pid, err)
	}
	defer windows.CloseHandle(h)
	if err := windows.TerminateProcess(h, 1); err != nil {
		if err == windows.ERROR_ACCESS_DENIED {
			return fmt.Errorf("%w: terminate pid %d", ErrAccess, pid)
		}
		return fmt.Errorf("%w: terminate pid %d: %v", ErrTerminate, pid, err)
	}
	return nil
}

func isGone(pid uint32) bool {
	if !processExists(pid) {
		return true
	}
	for i := 0; i < 10; i++ {
		time.Sleep(30 * time.Millisecond)
		if !processExists(pid) {
			return true
		}
	}
	return false
}

func processExists(pid uint32) bool {
	if pid == 0 {
		return false
	}
	h, err := openQuery(pid)
	if err != nil {
		if err == windows.ERROR_INVALID_PARAMETER {
			return false
		}
		// Access denied still means process exists.
		if err == windows.ERROR_ACCESS_DENIED {
			return true
		}
		// Toolhelp fallback: listed = exists
		_, _, ok := toolhelpName(pid)
		return ok
	}
	windows.CloseHandle(h)
	return true
}

func openQuery(pid uint32) (windows.Handle, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err == nil {
		return h, nil
	}
	// Some processes need the older query flag.
	return windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION, false, pid)
}

func toolhelpName(pid uint32) (name string, parent uint32, ok bool) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return "", 0, false
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	if err := windows.Process32First(snap, &pe); err != nil {
		return "", 0, false
	}
	for {
		if pe.ProcessID == pid {
			return windows.UTF16ToString(pe.ExeFile[:]), pe.ParentProcessID, true
		}
		if err := windows.Process32Next(snap, &pe); err != nil {
			break
		}
	}
	return "", 0, false
}

func parentPID(pid uint32) (uint32, error) {
	_, ppid, ok := toolhelpName(pid)
	if !ok {
		return 0, ErrNotFound
	}
	return ppid, nil
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

func stringPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

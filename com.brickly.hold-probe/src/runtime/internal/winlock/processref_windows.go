//go:build windows

package winlock

import (
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	// PROCESS_QUERY_INFORMATION | PROCESS_VM_READ — needed for PEB cwd.
	processQueryVM = windows.PROCESS_QUERY_INFORMATION | 0x0010
)

// 64-bit PEB / RTL_USER_PROCESS_PARAMETERS offsets (amd64 & arm64).
const (
	pebProcessParameters64 = 0x20
	rtlCurrentDirectory64  = 0x38
)

type processBasicInfo struct {
	Reserved1       uintptr
	PebBaseAddress  uintptr
	Reserved2       [2]uintptr
	UniqueProcessId uintptr
	Reserved3       uintptr
}

type unicodeStringRemote struct {
	Length        uint16
	MaximumLength uint16
	_             uint32
	Buffer        uintptr
}

type unicodeStringLocal struct {
	Length        uint16
	MaximumLength uint16
	_             uint32
	Buffer        *uint16
}

// probeProcessRefs — pure Win32 process image / command-line / cwd matching.
func probeProcessRefs(target string) ([]Holder, error) {
	target = filepath.Clean(target)
	targetLower := strings.ToLower(target)
	_ = enableDebugPrivilege()

	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, fmt.Errorf("%w: CreateToolhelp32Snapshot: %v", ErrProbe, err)
	}
	defer windows.CloseHandle(snap)

	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	if err := windows.Process32First(snap, &pe); err != nil {
		return nil, fmt.Errorf("%w: Process32First: %v", ErrProbe, err)
	}

	self := windows.GetCurrentProcessId()
	out := make([]Holder, 0, 8)

	for {
		pid := pe.ProcessID
		if pid != 0 && pid != self {
			exeName := windows.UTF16ToString(pe.ExeFile[:])
			if holder, ok := safeMatchProcessRef(pid, exeName, targetLower); ok {
				out = append(out, holder)
			}
		}
		if err := windows.Process32Next(snap, &pe); err != nil {
			break
		}
	}
	return out, nil
}

func safeMatchProcessRef(pid uint32, exeName, targetLower string) (holder Holder, ok bool) {
	defer func() {
		if recovered := recover(); recovered != nil {
			logf("process-ref panic pid=%d: %v", pid, recovered)
			holder, ok = Holder{}, false
		}
	}()
	return matchProcessRef(pid, exeName, targetLower)
}

func matchProcessRef(pid uint32, exeName, targetLower string) (Holder, bool) {
	// Fast path: image path only (cheap QueryFullProcessImageName).
	image := processImagePath(pid)
	imageLower := strings.ToLower(image)
	if pathIsReferenced(targetLower, imageLower, "", "") {
		return buildRefHolder(pid, exeName, image)
	}

	// Command line via ProcessCommandLineInformation (no PEB walk).
	cmdLine := processCommandLine(pid)
	cmdLower := strings.ToLower(cmdLine)
	if pathIsReferenced(targetLower, imageLower, cmdLower, "") {
		return buildRefHolder(pid, exeName, image)
	}

	// Cwd via PEB — only if still no hit; skip very system-looking names for speed.
	if !skipCwdProbe(exeName) {
		cwd := processCurrentDirectory(pid)
		if pathIsReferenced(targetLower, imageLower, cmdLower, strings.ToLower(filepath.Clean(cwd))) {
			return buildRefHolder(pid, exeName, image)
		}
	}
	return Holder{}, false
}

func skipCwdProbe(exeName string) bool {
	n := strings.ToLower(exeName)
	switch n {
	case "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "services.exe",
		"lsass.exe", "svchost.exe", "fontdrvhost.exe", "dwm.exe", "memory compression":
		return true
	default:
		return false
	}
}

func buildRefHolder(pid uint32, exeName, image string) (Holder, bool) {
	holder, err := holderFromPID(pid)
	if err != nil {
		name := exeName
		if name == "" {
			name = filepath.Base(image)
		}
		if name == "" || name == "." {
			name = fmt.Sprintf("pid-%d", pid)
		}
		return Holder{
			PID:             pid,
			ProcessName:     name,
			ApplicationType: "process-ref",
			Sources:         []Source{SourceProcessRef},
		}, true
	}
	holder.ApplicationType = "process-ref"
	holder.Sources = []Source{SourceProcessRef}
	return holder, true
}

func pathIsReferenced(target, image, cmd, cwd string) bool {
	if target == "" {
		return false
	}
	sep := string(filepath.Separator)
	if image != "" && (image == target || strings.HasPrefix(image, target+sep)) {
		return true
	}
	if cwd != "" && (cwd == target || strings.HasPrefix(cwd, target+sep)) {
		return true
	}
	if cmd != "" && strings.Contains(cmd, target) {
		return true
	}
	return false
}

func processImagePath(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	var buf [32768]uint16
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

func processCommandLine(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)

	// Start with a fixed buffer — avoid nil-buffer edge cases on some builds.
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

	// Buffer must point inside our returned allocation (ProcessCommandLineInformation layout).
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

func processCurrentDirectory(pid uint32) string {
	if unsafe.Sizeof(uintptr(0)) != 8 {
		return ""
	}
	h, err := windows.OpenProcess(processQueryVM, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)

	var pbi processBasicInfo
	var retLen uint32
	if err := windows.NtQueryInformationProcess(
		h,
		windows.ProcessBasicInformation,
		unsafe.Pointer(&pbi),
		uint32(unsafe.Sizeof(pbi)),
		&retLen,
	); err != nil || pbi.PebBaseAddress == 0 {
		return ""
	}

	var paramsAddr uintptr
	if err := readProcessMemory(h, pbi.PebBaseAddress+pebProcessParameters64, unsafe.Pointer(&paramsAddr), unsafe.Sizeof(paramsAddr)); err != nil || paramsAddr == 0 {
		return ""
	}
	cwd, _ := readRemoteUnicodeString(h, paramsAddr+rtlCurrentDirectory64)
	return cwd
}

func readRemoteUnicodeString(process windows.Handle, address uintptr) (string, error) {
	var us unicodeStringRemote
	if err := readProcessMemory(process, address, unsafe.Pointer(&us), unsafe.Sizeof(us)); err != nil {
		return "", err
	}
	if us.Length == 0 || us.Buffer == 0 {
		return "", nil
	}
	byteLen := int(us.Length)
	if byteLen < 2 || byteLen > 32*1024 {
		return "", nil
	}
	buf := make([]uint16, byteLen/2)
	if err := readProcessMemory(process, us.Buffer, unsafe.Pointer(&buf[0]), uintptr(byteLen)); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buf), nil
}

func readProcessMemory(process windows.Handle, address uintptr, buffer unsafe.Pointer, size uintptr) error {
	var read uintptr
	err := windows.ReadProcessMemory(process, address, (*byte)(buffer), size, &read)
	if err != nil {
		return err
	}
	if read != size {
		return fmt.Errorf("short read %d/%d", read, size)
	}
	return nil
}

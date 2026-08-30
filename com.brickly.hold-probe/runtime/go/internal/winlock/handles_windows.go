//go:build windows

package winlock

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	systemExtendedHandleInformation = 64
	objectNameInformation           = 1
	statusInfoLengthMismatch        = 0xC0000004
	statusSuccess                   = 0
)

var (
	ntdll                        = windows.NewLazySystemDLL("ntdll.dll")
	procNtQuerySystemInformation = ntdll.NewProc("NtQuerySystemInformation")
	procNtQueryObject            = ntdll.NewProc("NtQueryObject")
)

type systemHandleTableEntryInfoEx struct {
	Object                uintptr
	UniqueProcessId       uintptr
	HandleValue           uintptr
	GrantedAccess         uint32
	CreatorBackTraceIndex uint16
	ObjectTypeIndex       uint16
	HandleAttributes      uint32
	Reserved              uint32
}

type unicodeString struct {
	Length        uint16
	MaximumLength uint16
	Buffer        *uint16
}

// probeHandles walks system file handles and matches the target path.
// Opt-in only: full-system handle walk is intentionally bounded.
func probeHandles(target string) ([]Holder, error) {
	_ = enableDebugPrivilege()

	ntPath, err := toNTPath(target)
	if err != nil {
		return nil, err
	}
	ntPath = strings.ToLower(ntPath)
	targetLower := strings.ToLower(filepath.Clean(target))

	// Keep target open so its handle appears in the system table (for File type index).
	var keepOpen windows.Handle
	if p, err := windows.UTF16PtrFromString(target); err == nil {
		h, err := windows.CreateFile(
			p,
			windows.GENERIC_READ,
			windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
			nil,
			windows.OPEN_EXISTING,
			windows.FILE_FLAG_BACKUP_SEMANTICS,
			0,
		)
		if err == nil {
			keepOpen = h
			defer windows.CloseHandle(keepOpen)
		}
	}

	// listSystemHandles can take a long time on busy systems; hard-cap it.
	handles, err := runWithTimeout(6*time.Second, listSystemHandles)
	if err != nil {
		return nil, err
	}

	selfPID := windows.GetCurrentProcessId()
	var typeIndex uint16
	haveType := false
	if keepOpen != 0 {
		for _, h := range handles {
			if uint32(h.UniqueProcessId) == selfPID && windows.Handle(h.HandleValue) == keepOpen {
				typeIndex = h.ObjectTypeIndex
				haveType = true
				break
			}
		}
	}

	seen := map[uint32]Holder{}
	deadline := time.Now().Add(12 * time.Second)

	byPID := map[uint32][]windows.Handle{}
	for _, h := range handles {
		pid := uint32(h.UniqueProcessId)
		if pid == 0 || pid == selfPID {
			continue
		}
		if haveType && h.ObjectTypeIndex != typeIndex {
			continue
		}
		byPID[pid] = append(byPID[pid], windows.Handle(h.HandleValue))
	}

	for pid, list := range byPID {
		if time.Now().After(deadline) {
			break
		}
		process, err := windows.OpenProcess(windows.PROCESS_DUP_HANDLE, false, pid)
		if err != nil {
			continue
		}
		matched := false
		for _, handle := range list {
			if time.Now().After(deadline) {
				break
			}
			name, ok := queryHandleNameFromProcess(process, handle)
			if !ok || name == "" {
				continue
			}
			if !pathMatches(strings.ToLower(name), ntPath, targetLower) {
				continue
			}
			matched = true
			break
		}
		windows.CloseHandle(process)
		if !matched {
			continue
		}
		if _, exists := seen[pid]; exists {
			continue
		}
		holder, err := holderFromPID(pid)
		if err != nil {
			seen[pid] = Holder{
				PID:         pid,
				ProcessName: fmt.Sprintf("pid-%d", pid),
				Sources:     []Source{SourceHandleScan},
			}
			continue
		}
		holder.Sources = []Source{SourceHandleScan}
		seen[pid] = holder
	}

	out := make([]Holder, 0, len(seen))
	for _, h := range seen {
		out = append(out, h)
	}
	return out, nil
}

func pathMatches(handleName, ntTarget, winTarget string) bool {
	if handleName == ntTarget || handleName == winTarget {
		return true
	}
	// Prefix match for directory holds and nested opens.
	if strings.HasPrefix(handleName, ntTarget+`\`) || strings.HasPrefix(handleName, winTarget+`\`) {
		return true
	}
	// Some names omit drive and use \Device\...
	if strings.HasSuffix(handleName, strings.TrimPrefix(winTarget, filepath.VolumeName(winTarget))) {
		// weak fallback — only exact suffix after volume
		suffix := strings.ToLower(strings.TrimPrefix(winTarget, filepath.VolumeName(winTarget)))
		if suffix != "" && (strings.HasSuffix(handleName, suffix) || strings.Contains(handleName, suffix+`\`)) {
			return true
		}
	}
	return false
}

func listSystemHandles() ([]systemHandleTableEntryInfoEx, error) {
	size := uint32(1 << 20)
	for attempt := 0; attempt < 8; attempt++ {
		buf := make([]byte, size)
		var retLen uint32
		r, _, _ := procNtQuerySystemInformation.Call(
			uintptr(systemExtendedHandleInformation),
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(size),
			uintptr(unsafe.Pointer(&retLen)),
		)
		if r == statusInfoLengthMismatch {
			if retLen > size {
				size = retLen + (1 << 16)
			} else {
				size *= 2
			}
			continue
		}
		if r != statusSuccess {
			return nil, fmt.Errorf("%w: NtQuerySystemInformation 0x%X", ErrProbe, r)
		}
		// First field is NumberOfHandles (ULONG_PTR)
		number := *(*uintptr)(unsafe.Pointer(&buf[0]))
		entrySize := unsafe.Sizeof(systemHandleTableEntryInfoEx{})
		// Header is ULONG_PTR NumberOfHandles + ULONG_PTR Reserved on 64-bit
		headerSize := unsafe.Sizeof(uintptr(0)) * 2
		if uintptr(len(buf)) < headerSize {
			return nil, fmt.Errorf("%w: handle buffer too small", ErrProbe)
		}
		out := make([]systemHandleTableEntryInfoEx, 0, number)
		base := uintptr(unsafe.Pointer(&buf[0])) + headerSize
		for i := uintptr(0); i < number; i++ {
			entry := *(*systemHandleTableEntryInfoEx)(unsafe.Pointer(base + i*entrySize))
			out = append(out, entry)
		}
		return out, nil
	}
	return nil, fmt.Errorf("%w: handle list buffer growth exhausted", ErrProbe)
}

func queryHandleNameFromProcess(process windows.Handle, handle windows.Handle) (string, bool) {
	var dup windows.Handle
	err := windows.DuplicateHandle(
		process,
		handle,
		windows.CurrentProcess(),
		&dup,
		0,
		false,
		windows.DUPLICATE_SAME_ACCESS,
	)
	if err != nil {
		return "", false
	}
	defer windows.CloseHandle(dup)

	var retLen uint32
	r, _, _ := procNtQueryObject.Call(
		uintptr(dup),
		uintptr(objectNameInformation),
		0,
		0,
		uintptr(unsafe.Pointer(&retLen)),
	)
	if retLen == 0 {
		return "", false
	}
	buf := make([]byte, retLen+64)
	r, _, _ = procNtQueryObject.Call(
		uintptr(dup),
		uintptr(objectNameInformation),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(&retLen)),
	)
	if r != statusSuccess {
		return "", false
	}
	us := (*unicodeString)(unsafe.Pointer(&buf[0]))
	if us.Length == 0 || us.Buffer == nil {
		return "", false
	}
	length := int(us.Length / 2)
	slice := unsafe.Slice(us.Buffer, length)
	return windows.UTF16ToString(slice), true
}

func toNTPath(winPath string) (string, error) {
	// GetFinalPathNameByHandle requires an open handle.
	p, err := windows.UTF16PtrFromString(winPath)
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(
		p,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS, // works for directories too
		0,
	)
	if err != nil {
		// Fall back to cleaned Win32 path; matcher still has Win32 form.
		return filepath.Clean(winPath), nil
	}
	defer windows.CloseHandle(handle)

	// VOLUME_NAME_NT = 0x2 → \Device\HarddiskVolumeX\...
	const volumeNameNT = 0x2
	buf := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(handle, &buf[0], uint32(len(buf)), volumeNameNT)
	if err != nil || n == 0 {
		return filepath.Clean(winPath), nil
	}
	return windows.UTF16ToString(buf[:n]), nil
}

func holderFromPID(pid uint32) (Holder, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return Holder{}, err
	}
	defer windows.CloseHandle(h)

	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &creation, &exit, &kernel, &user); err != nil {
		return Holder{}, err
	}
	startKey := filetimeToUint64(creation)

	var buf [windows.MAX_PATH]uint16
	size := uint32(len(buf))
	name := fmt.Sprintf("pid-%d", pid)
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err == nil {
		full := windows.UTF16ToString(buf[:size])
		name = filepath.Base(full)
	}

	return Holder{
		PID:         pid,
		StartKey:    strconv.FormatUint(startKey, 10),
		ProcessName: name,
		StartedAt:   filetimeToRFC3339(startKey),
		Sources:     []Source{SourceHandleScan},
	}, nil
}

func enableDebugPrivilege() error {
	var token windows.Token
	err := windows.OpenProcessToken(
		windows.CurrentProcess(),
		windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY,
		&token,
	)
	if err != nil {
		return err
	}
	defer token.Close()

	var luid windows.LUID
	err = windows.LookupPrivilegeValue(nil, windows.StringToUTF16Ptr("SeDebugPrivilege"), &luid)
	if err != nil {
		return err
	}
	tp := windows.Tokenprivileges{
		PrivilegeCount: 1,
		Privileges: [1]windows.LUIDAndAttributes{
			{Luid: luid, Attributes: windows.SE_PRIVILEGE_ENABLED},
		},
	}
	return windows.AdjustTokenPrivileges(token, false, &tp, 0, nil, nil)
}

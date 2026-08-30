//go:build windows

package everything

import (
	"syscall"
	"unsafe"
)

const (
	th32csSnapProcess              = 0x00000002
	processQueryLimitedInformation = 0x1000
)

type processEntry32 struct {
	Size            uint32
	Usage           uint32
	ProcessID       uint32
	DefaultHeapID   uintptr
	ModuleID        uint32
	Threads         uint32
	ParentProcessID uint32
	PriClassBase    int32
	Flags           uint32
	ExeFile         [260]uint16
}

func FindBundledProcess(bundledExe string) (string, bool) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	create := kernel32.NewProc("CreateToolhelp32Snapshot")
	procFirst := kernel32.NewProc("Process32FirstW")
	procNext := kernel32.NewProc("Process32NextW")
	closeHandle := kernel32.NewProc("CloseHandle")
	openProcess := kernel32.NewProc("OpenProcess")
	queryImage := kernel32.NewProc("QueryFullProcessImageNameW")

	snap, _, _ := create.Call(th32csSnapProcess, 0)
	if snap == 0 || snap == uintptr(syscall.InvalidHandle) {
		return "", false
	}
	defer closeHandle.Call(snap)

	var entry processEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if ret, _, _ := procFirst.Call(snap, uintptr(unsafe.Pointer(&entry))); ret == 0 {
		return "", false
	}

	for {
		name := syscall.UTF16ToString(entry.ExeFile[:])
		if isEverythingProcess(name) {
			path := queryProcessImagePath(openProcess, queryImage, closeHandle, entry.ProcessID)
			if path == "" {
				path = name
			}
			if bundledExe == "" || sameFilePath(path, bundledExe) {
				return path, true
			}
		}
		if ret, _, _ := procNext.Call(snap, uintptr(unsafe.Pointer(&entry))); ret == 0 {
			return "", false
		}
	}
}

func queryProcessImagePath(
	openProcess *syscall.LazyProc,
	queryImage *syscall.LazyProc,
	closeHandle *syscall.LazyProc,
	pid uint32,
) string {
	handle, _, _ := openProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if handle == 0 {
		return ""
	}
	defer closeHandle.Call(handle)

	buf := make([]uint16, syscall.MAX_PATH)
	size := uint32(len(buf))
	ok, _, _ := queryImage.Call(handle, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if ok == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

//go:build windows

package winlock

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	errorSuccess  = uintptr(0)
	errorMoreData = uintptr(234)
)

var (
	rstrtmgr           = windows.NewLazySystemDLL("rstrtmgr.dll")
	procRmStartSession = rstrtmgr.NewProc("RmStartSession")
	procRmRegister     = rstrtmgr.NewProc("RmRegisterResources")
	procRmGetList      = rstrtmgr.NewProc("RmGetList")
	procRmEndSession   = rstrtmgr.NewProc("RmEndSession")
)

type rmUniqueProcess struct {
	PID       uint32
	StartTime windows.Filetime
}

type rmProcessInfo struct {
	Process         rmUniqueProcess
	ApplicationName [256]uint16
	ServiceName     [64]uint16
	ApplicationType uint32
	Status          uint32
	SessionID       uint32
	Restartable     int32
}

func probeRestartManager(path string) ([]Holder, error) {
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, fmt.Errorf("%w: session key: %v", ErrProbe, err)
	}
	key, err := windows.UTF16PtrFromString(hex.EncodeToString(keyBytes))
	if err != nil {
		return nil, fmt.Errorf("%w: session key encode: %v", ErrProbe, err)
	}

	var session uint32
	code, _, _ := procRmStartSession.Call(
		uintptr(unsafe.Pointer(&session)),
		0,
		uintptr(unsafe.Pointer(key)),
	)
	if code != errorSuccess {
		return nil, mapRmError("RmStartSession", code)
	}
	defer procRmEndSession.Call(uintptr(session))

	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, fmt.Errorf("%w: path encode: %v", ErrProbe, err)
	}
	files := []*uint16{pathPtr}
	code, _, _ = procRmRegister.Call(
		uintptr(session),
		1,
		uintptr(unsafe.Pointer(&files[0])),
		0, 0, 0, 0,
	)
	if code != errorSuccess {
		return nil, mapRmError("RmRegisterResources", code)
	}

	var needed, count uint32
	var rebootReasons uint32
	code, _, _ = procRmGetList.Call(
		uintptr(session),
		uintptr(unsafe.Pointer(&needed)),
		uintptr(unsafe.Pointer(&count)),
		0,
		uintptr(unsafe.Pointer(&rebootReasons)),
	)
	if code == errorSuccess {
		return []Holder{}, nil
	}
	if code != errorMoreData {
		return nil, mapRmError("RmGetList", code)
	}

	if needed == 0 {
		return []Holder{}, nil
	}
	buf := make([]rmProcessInfo, needed)
	count = needed
	code, _, _ = procRmGetList.Call(
		uintptr(session),
		uintptr(unsafe.Pointer(&needed)),
		uintptr(unsafe.Pointer(&count)),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&rebootReasons)),
	)
	if code != errorSuccess {
		return nil, mapRmError("RmGetList", code)
	}

	out := make([]Holder, 0, count)
	for i := uint32(0); i < count; i++ {
		info := buf[i]
		name := utf16z(info.ApplicationName[:])
		if name == "" {
			name = utf16z(info.ServiceName[:])
		}
		startKey := filetimeToUint64(info.Process.StartTime)
		out = append(out, Holder{
			PID:             info.Process.PID,
			StartKey:        strconv.FormatUint(startKey, 10),
			ProcessName:     name,
			ApplicationType: appTypeName(info.ApplicationType),
			Status:          info.Status,
			Restartable:     info.Restartable != 0,
			SessionID:       info.SessionID,
			StartedAt:       filetimeToRFC3339(startKey),
			Sources:         []Source{SourceRestartManager},
		})
	}
	return out, nil
}

func mapRmError(op string, code uintptr) error {
	if code == 5 {
		return fmt.Errorf("%w: %s", ErrAccess, op)
	}
	return fmt.Errorf("%w: %s returned %d", ErrProbe, op, code)
}

func utf16z(v []uint16) string {
	n := 0
	for n < len(v) && v[n] != 0 {
		n++
	}
	return string(utf16.Decode(v[:n]))
}

func filetimeToUint64(ft windows.Filetime) uint64 {
	return (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
}

func filetimeToRFC3339(value uint64) string {
	const epochDiff = uint64(116444736000000000)
	if value < epochDiff {
		return ""
	}
	ns := int64(value-epochDiff) * 100
	return time.Unix(0, ns).UTC().Format(time.RFC3339Nano)
}

func appTypeName(v uint32) string {
	switch v {
	case 1:
		return "main-window"
	case 2:
		return "other-window"
	case 3:
		return "service"
	case 4:
		return "explorer"
	case 5:
		return "console"
	case 1000:
		return "critical"
	default:
		return "unknown"
	}
}

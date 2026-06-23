//go:build windows

package preview

import (
	"syscall"
	"unicode/utf16"
	"unsafe"
)

const codePageGBK uint32 = 936

var (
	kernel32                = syscall.NewLazyDLL("kernel32.dll")
	procMultiByteToWideChar = kernel32.NewProc("MultiByteToWideChar")
)

func decodeLegacyArchiveName(data []byte) (string, bool) {
	return decodeWindowsCodePage(data, codePageGBK)
}

func decodeWindowsCodePage(data []byte, codePage uint32) (string, bool) {
	if len(data) == 0 {
		return "", false
	}
	length, _, _ := procMultiByteToWideChar.Call(
		uintptr(codePage),
		0,
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(len(data)),
		0,
		0,
	)
	if length == 0 {
		return "", false
	}
	buffer := make([]uint16, length)
	written, _, _ := procMultiByteToWideChar.Call(
		uintptr(codePage),
		0,
		uintptr(unsafe.Pointer(&data[0])),
		uintptr(len(data)),
		uintptr(unsafe.Pointer(&buffer[0])),
		length,
	)
	if written == 0 {
		return "", false
	}
	return string(utf16.Decode(buffer[:written])), true
}

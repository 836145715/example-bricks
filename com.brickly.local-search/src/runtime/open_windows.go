//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

const shellExecuteShowNormal = 1

func openLocalPath(path string) error {
	verb, err := syscall.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	shell32 := syscall.NewLazyDLL("shell32.dll")
	shellExecute := shell32.NewProc("ShellExecuteW")
	ret, _, callErr := shellExecute.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		0,
		0,
		shellExecuteShowNormal,
	)
	if ret <= 32 {
		if callErr != syscall.Errno(0) {
			return callErr
		}
		return fmt.Errorf("ShellExecuteW 失败，返回码 %d", ret)
	}
	return nil
}

// revealLocalPath 在资源管理器中定位路径。explorer 的 /select, 参数要求
// “/select,<路径>”整串且路径带引号；explorer 成功时也常返回非零退出码，
// 只能 Start 后不等待结果。
func revealLocalPath(path string) error {
	cmd := exec.Command("explorer.exe", `/select,"`+path+`"`)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

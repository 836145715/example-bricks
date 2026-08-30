//go:build windows

package everything

import (
	"os/exec"
	"path/filepath"
	"syscall"
)

func StartBundled() error {
	exe := BundledExePath()
	if !fileExists(exe) {
		return errBundledMissing()
	}
	_ = ensureRunAsAdminIni()
	args := []string{"-admin", "-startup"}
	if instanceNameForStart != "" {
		args = append(args, "-instance", instanceNameForStart)
	}
	cmd := exec.Command(exe, args...)
	cmd.Dir = filepath.Dir(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	return cmd.Start()
}

func ExitBundled() error {
	exe := BundledExePath()
	if !fileExists(exe) {
		return errBundledMissing()
	}
	args := []string{"-exit"}
	if instanceNameForStart != "" {
		args = append([]string{"-instance", instanceNameForStart}, args...)
	}
	cmd := exec.Command(exe, args...)
	cmd.Dir = filepath.Dir(exe)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	return cmd.Run()
}

func errBundledMissing() error {
	return &SDKError{Code: ErrorIPC, Text: ReasonMessage(ReasonNotInstalled)}
}

package everything

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	InstanceName   = "Brickly"
	runtimeRelPath = "runtime/win-x64"
	dllName        = "Everything64.dll"
	exeName        = "Everything.exe"
)

var (
	bundledStartMu      sync.Mutex
	bundledStarted      bool
	instanceNameForStart string
)

func enableNamedInstance() {
	instanceNameForStart = InstanceName
}

func RuntimeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return filepath.Clean(runtimeRelPath)
	}
	brickRoot := filepath.Clean(filepath.Join(filepath.Dir(exe), "..", ".."))
	return filepath.Join(brickRoot, "runtime", "win-x64")
}

func BundledDLLPath() string {
	return filepath.Join(RuntimeDir(), dllName)
}

func BundledExePath() string {
	return filepath.Join(RuntimeDir(), exeName)
}

func BundledExeExists() bool {
	return fileExists(BundledExePath())
}

func EnsureBundledStarted() {
	exe := BundledExePath()
	if !fileExists(exe) {
		return
	}
	bundledStartMu.Lock()
	defer bundledStartMu.Unlock()
	if _, running := FindBundledProcess(exe); running {
		bundledStarted = true
		return
	}
	// -admin 会先弹出 UAC，此时进程还没起来。已经发起过一次就不要再拉起，否则会反复弹窗。
	if bundledStarted {
		return
	}
	if err := StartBundled(); err == nil {
		bundledStarted = true
	}
}

func isEverythingProcess(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "everything.exe" || lower == "everything64.exe" {
		return true
	}
	return strings.HasPrefix(lower, "everything") && strings.HasSuffix(lower, ".exe")
}

func sameFilePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	left, err := filepath.Abs(filepath.Clean(a))
	if err != nil {
		left = filepath.Clean(a)
	}
	right, err := filepath.Abs(filepath.Clean(b))
	if err != nil {
		right = filepath.Clean(b)
	}
	return strings.EqualFold(left, right)
}

package everything

import (
	"path/filepath"
	"testing"
)

func TestIsEverythingProcess(t *testing.T) {
	if !isEverythingProcess("Everything.exe") || !isEverythingProcess("Everything64.exe") {
		t.Fatal("expected official exe names to match")
	}
	if isEverythingProcess("explorer.exe") {
		t.Fatal("explorer should not match")
	}
}

func TestSameFilePath(t *testing.T) {
	left := filepath.Join(`C:\Brick`, "runtime", "win-x64", "Everything.exe")
	right := filepath.Join(`c:\brick`, "runtime", "win-x64", "Everything.exe")
	if !sameFilePath(left, right) {
		t.Fatalf("expected %q and %q to match", left, right)
	}
}

func TestBundledPathsUseRuntimeDir(t *testing.T) {
	if filepath.Base(BundledDLLPath()) != dllName {
		t.Fatalf("dll base = %q", BundledDLLPath())
	}
	if filepath.Base(BundledExePath()) != exeName {
		t.Fatalf("exe base = %q", BundledExePath())
	}
}

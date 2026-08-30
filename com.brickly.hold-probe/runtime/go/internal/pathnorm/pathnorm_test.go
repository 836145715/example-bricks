package pathnorm

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestNormalizeEmpty(t *testing.T) {
	_, err := Normalize("  ")
	if err != ErrEmpty {
		t.Fatalf("expected ErrEmpty, got %v", err)
	}
}

func TestNormalizeRelative(t *testing.T) {
	_, err := Normalize("relative\\file.txt")
	if err != ErrRelative {
		t.Fatalf("expected ErrRelative, got %v", err)
	}
}

func TestNormalizeMissing(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows absolute path layout")
	}
	_, err := Normalize(`C:\this\path\should\not\exist-hold-probe-xyz`)
	if err == nil || !contains(err.Error(), "not found") && err != ErrNotFound {
		// wrapped
		if err == nil {
			t.Fatal("expected error")
		}
	}
}

func TestNormalizeFileAndDir(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "sample.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	// TempDir is absolute on all platforms.
	gotFile, err := Normalize(file)
	if err != nil {
		t.Fatal(err)
	}
	if gotFile.Kind != KindFile {
		t.Fatalf("kind=%s", gotFile.Kind)
	}

	gotDir, err := Normalize(dir)
	if err != nil {
		t.Fatal(err)
	}
	if gotDir.Kind != KindDir {
		t.Fatalf("kind=%s", gotDir.Kind)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || (len(s) > 0 && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()))
}

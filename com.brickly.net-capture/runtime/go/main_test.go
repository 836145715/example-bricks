package main

import (
	"runtime"
	"testing"
)

func TestPlatformKey(t *testing.T) {
	cases := []struct {
		goos string
		arch string
		want string
	}{
		{goos: "windows", arch: "amd64", want: "win-x64"},
		{goos: "darwin", arch: "amd64", want: "mac-x64"},
		{goos: "darwin", arch: "arm64", want: "mac-arm64"},
		{goos: "linux", arch: "arm64", want: "linux-arm64"},
		{goos: "freebsd", arch: "amd64", want: "freebsd-amd64"},
	}
	for _, item := range cases {
		if got := platformKey(item.goos, item.arch); got != item.want {
			t.Fatalf("platformKey(%q, %q) = %q, want %q", item.goos, item.arch, got, item.want)
		}
	}
}

func TestSupportsDriverMode(t *testing.T) {
	if ok, reason := supportsDriverMode("off"); !ok || reason != "" {
		t.Fatalf("off driver should always be supported, got ok=%v reason=%q", ok, reason)
	}

	ok, reason := supportsDriverMode("tun")
	switch runtime.GOOS {
	case "windows":
		if !ok || reason != "" {
			t.Fatalf("windows should allow driver mode, got ok=%v reason=%q", ok, reason)
		}
	default:
		if ok || reason == "" {
			t.Fatalf("%s should reject driver mode with a reason, got ok=%v reason=%q", runtime.GOOS, ok, reason)
		}
	}
}

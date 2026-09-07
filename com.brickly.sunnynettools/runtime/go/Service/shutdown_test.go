package Service

import (
	"os"
	"strings"
	"testing"
)

func TestPidAliveSelf(t *testing.T) {
	if !pidAlive(int32(os.Getpid())) {
		t.Fatal("current process should be alive")
	}
	if pidAlive(0) || pidAlive(-1) {
		t.Fatal("invalid pid must be dead")
	}
}

func TestExitCleanupIdempotent(t *testing.T) {
	var a *AppMain
	a.ExitCleanup()
	a.Shutdown()
}

func TestShutdownSourceNeverUnDrive(t *testing.T) {
	raw, err := os.ReadFile("shutdown.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), ".UnDrive(") {
		t.Fatal("shutdown must not call UnDrive")
	}
}

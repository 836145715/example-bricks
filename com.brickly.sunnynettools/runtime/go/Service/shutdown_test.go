package Service

import (
	"os"
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

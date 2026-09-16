package engine

import "testing"

func TestNewEngineHasSunny(t *testing.T) {
	e := New()
	if e.Sunny() == nil {
		t.Fatal("expected sunny instance")
	}
	if e.LastError() != "" && e.Running() {
		t.Fatal("running with error")
	}
	e.Close()
}

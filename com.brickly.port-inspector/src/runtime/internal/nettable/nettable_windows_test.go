//go:build windows

package nettable

import "testing"

func TestListPlatformWindowsSmoke(t *testing.T) {
	rows, method, err := listPlatform()
	if err != nil {
		t.Fatalf("listPlatform: %v", err)
	}
	if method != "api" {
		t.Fatalf("expected method api, got %q", method)
	}
	if len(rows) == 0 {
		t.Fatalf("expected some socket rows on windows")
	}
	// At least one row should carry pid when OS exposes owners.
	hasPid := false
	for _, row := range rows {
		if row.PID != nil && *row.PID > 0 {
			hasPid = true
			if row.LocalPort <= 0 {
				t.Fatalf("invalid local port: %+v", row)
			}
		}
	}
	if !hasPid {
		t.Fatalf("expected at least one row with pid")
	}
}

//go:build windows

package nettable

import (
	"testing"

	"brickly/port-inspector/internal/procinfo"
)

func TestDetailsCoverage(t *testing.T) {
	r, err := List(Filter{Protocol: "all", IncludeEstablished: true, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	withName := 0
	var sample *Row
	for i := range r.Rows {
		if r.Rows[i].ProcessName != nil && *r.Rows[i].ProcessName != "" {
			withName++
		}
		if sample == nil && r.Rows[i].PID != nil && *r.Rows[i].PID > 0 {
			sample = &r.Rows[i]
		}
	}
	t.Logf("rows=%d withProcessName=%d", len(r.Rows), withName)
	if sample == nil {
		t.Fatal("no sample with pid")
	}
	d, err := procinfo.GetDetails(*sample.PID)
	if err != nil {
		t.Fatalf("GetDetails: %v", err)
	}
	t.Logf("pid=%d name=%v path=%v cmd=%v", d.PID, d.ProcessName, d.ExecutablePath, d.CommandLine)
}

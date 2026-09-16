package proxy

import "testing"

func TestReleaseCaptureNeverUnDrive(t *testing.T) {
	c := New(nil)
	c.ReleaseCapture()
	c.ProcessCancelAll()
	if c.OpenDrive(0) {
		t.Fatal("nil app should not open drive")
	}
}

package Service

import "testing"

func TestCaptureFlagsRoundTrip(t *testing.T) {
	captureClearAllFlags()
	t.Cleanup(captureClearAllFlags)

	captureSetFlags(42, 1, true)
	got := captureGetFlags(42)
	if got.BreakMode != 1 || !got.GuaranteeDisplay {
		t.Fatalf("got %+v", got)
	}

	captureMergeBreakMode(42, 2)
	got = captureGetFlags(42)
	if got.BreakMode != 2 || !got.GuaranteeDisplay {
		t.Fatalf("merge got %+v", got)
	}

	captureClearFlags(42)
	got = captureGetFlags(42)
	if got.BreakMode != 0 || got.GuaranteeDisplay {
		t.Fatalf("cleared %+v", got)
	}
}

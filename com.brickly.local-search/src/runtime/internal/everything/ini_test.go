package everything

import (
	"strings"
	"testing"
)

func TestUpsertIniWritesAdminFlags(t *testing.T) {
	got := upsertIni("", map[string]string{
		"allow_run_as_admin": "1",
		"run_as_admin":       "1",
		"index_as_admin":     "1",
	})
	for _, key := range []string{"allow_run_as_admin=1", "run_as_admin=1", "index_as_admin=1"} {
		if !strings.Contains(got, key) {
			t.Fatalf("missing %s in %q", key, got)
		}
	}
}

func TestUpsertIniReplacesExisting(t *testing.T) {
	got := upsertIni("run_as_admin=0\nlanguage=1033\n", map[string]string{
		"run_as_admin": "1",
	})
	if strings.Contains(got, "run_as_admin=0") {
		t.Fatalf("did not replace old value: %q", got)
	}
	if !strings.Contains(got, "run_as_admin=1") || !strings.Contains(got, "language=1033") {
		t.Fatalf("unexpected ini: %q", got)
	}
}

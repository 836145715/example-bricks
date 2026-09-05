package volume

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

type fakeRunner struct {
	outputs map[string][]byte
	errs    map[string]error
}

func (f fakeRunner) Output(name string, args ...string) ([]byte, error) {
	key := name + " " + strings.Join(args, " ")
	if err, ok := f.errs[key]; ok {
		return nil, err
	}
	return f.outputs[key], nil
}

func TestParseSnapshots(t *testing.T) {
	out := "Snapshots for /:\ncom.apple.TimeMachine.2026-08-01-120000.local\ncom.apple.TimeMachine.2026-08-02-093000.local\n\n"
	got := ParseSnapshots(out)
	if !reflect.DeepEqual(got, []string{
		"com.apple.TimeMachine.2026-08-01-120000.local",
		"com.apple.TimeMachine.2026-08-02-093000.local",
	}) {
		t.Errorf("snapshots = %#v", got)
	}
	if got := ParseSnapshots(""); len(got) != 0 {
		t.Errorf("empty snapshots = %#v", got)
	}
	// tmutil 报错文本不应被当成快照。
	if got := ParseSnapshots("tmutil: No snapshots for /\n"); len(got) != 0 {
		t.Errorf("error text parsed as snapshots: %#v", got)
	}
}

func TestLookupPurgeable(t *testing.T) {
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>VolumeName</key>
	<string>Macintosh HD</string>
	<key>FreeSpace</key>
	<integer>123456</integer>
	<key>APFSContainer</key>
	<dict>
		<key>CapacityInUse</key>
		<integer>999</integer>
	</dict>
	<key>Purgeable</key>
	<integer>5368709120</integer>
	<key>FilesystemType</key>
	<string>APFS</string>
</dict>
</plist>`
	got, ok := LookupPurgeable([]byte(plist))
	if !ok || got != 5368709120 {
		t.Errorf("purgeable = %d (%v), want 5368709120", got, ok)
	}

	// 没有 Purgeable 键。
	without := `<?xml version="1.0"?><plist version="1.0"><dict><key>FreeSpace</key><integer>1</integer></dict></plist>`
	if _, ok := LookupPurgeable([]byte(without)); ok {
		t.Errorf("missing key should return false")
	}
	// 非法输入。
	if _, ok := LookupPurgeable([]byte("not a plist")); ok {
		t.Errorf("garbage should return false")
	}
}

func TestEnrich(t *testing.T) {
	runner := fakeRunner{
		outputs: map[string][]byte{
			"diskutil info -plist /":      []byte(`<plist version="1.0"><dict><key>Purgeable</key><integer>100</integer></dict></plist>`),
			"tmutil listlocalsnapshots /": []byte("Snapshots for /:\ncom.apple.TimeMachine.2026-01-01-000000.local\n"),
		},
	}
	info := Enrich(Info{Path: "/", Snapshots: nil}, runner)
	if info.PurgeableBytes == nil || *info.PurgeableBytes != 100 {
		t.Errorf("purgeable = %v", info.PurgeableBytes)
	}
	if len(info.Snapshots) != 1 {
		t.Errorf("snapshots = %#v", info.Snapshots)
	}
	if info.SnapshotsError != "" {
		t.Errorf("unexpected snapshotsError: %s", info.SnapshotsError)
	}

	failRunner := fakeRunner{
		errs: map[string]error{
			"diskutil info -plist /":      errors.New("exit 1"),
			"tmutil listlocalsnapshots /": errors.New("tmutil failed"),
		},
	}
	info = Enrich(Info{Path: "/"}, failRunner)
	if info.PurgeableBytes != nil {
		t.Errorf("purgeable should stay nil on failure")
	}
	if info.SnapshotsError == "" {
		t.Errorf("snapshotsError should be set on failure")
	}
	if info.Snapshots == nil || len(info.Snapshots) != 0 {
		t.Errorf("snapshots should be empty array, got %#v", info.Snapshots)
	}
}

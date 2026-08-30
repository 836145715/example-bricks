//go:build darwin

package winlock

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestParseLsofMachineOutput(t *testing.T) {
	raw := []byte("p42\x00cCode Helper\x00\n" +
		"fcwd\x00tDIR\x00n/Users/xuan/project\x00\n" +
		"f12u\x00tREG\x00n/Users/xuan/project/data.db\x00\n" +
		"p99\x00czsh\x00\n" +
		"ftxt\x00tREG\x00n/bin/zsh\x00\n")

	got, err := parseLsofMachineOutput(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := []lsofProcess{
		{
			PID:     42,
			Command: "Code Helper",
			Files: []lsofFile{
				{FD: "cwd", Type: "DIR", Name: "/Users/xuan/project"},
				{FD: "12u", Type: "REG", Name: "/Users/xuan/project/data.db"},
			},
		},
		{
			PID:     99,
			Command: "zsh",
			Files:   []lsofFile{{FD: "txt", Type: "REG", Name: "/bin/zsh"}},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parsed output mismatch\n got: %#v\nwant: %#v", got, want)
	}
}

func TestProbeFindsProcessHoldingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "held.log")
	if err := os.WriteFile(path, []byte("held\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("/usr/bin/tail", "-f", path)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	deadline := time.Now().Add(3 * time.Second)
	for {
		result, err := Probe(path, "file", false)
		if err != nil {
			t.Fatal(err)
		}
		for _, holder := range result.Holders {
			if holder.PID == uint32(cmd.Process.Pid) {
				if holder.StartKey == "" || holder.ProcessName == "" {
					t.Fatalf("incomplete holder: %#v", holder)
				}
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("tail pid %d not found: %#v", cmd.Process.Pid, result)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestLsofArgsByTargetKind(t *testing.T) {
	path := "/Users/xuan/project"
	tests := []struct {
		name string
		kind string
		deep bool
		want []string
	}{
		{name: "file", kind: "file", want: []string{"-nP", "-F0pcftn", "--", path}},
		{name: "directory", kind: "directory", want: []string{"-nP", "-F0pcftn", "+d", path}},
		{name: "deep directory", kind: "directory", deep: true, want: []string{"-nP", "-F0pcftn", "+D", path}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := lsofArgs(path, tt.kind, tt.deep); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("args=%q want=%q", got, tt.want)
			}
		})
	}
}

func TestClassifyLsofExit(t *testing.T) {
	if warning, err := classifyLsofExit(1, nil, nil); err != nil || warning != "" {
		t.Fatalf("empty exit 1 should mean no matches: %v", err)
	}
	if _, err := classifyLsofExit(1, nil, []byte("lsof: status error on /root: Permission denied")); !errors.Is(err, ErrAccess) {
		t.Fatalf("permission error=%v", err)
	}
	warning, err := classifyLsofExit(
		1,
		[]byte("p42\x00ctail\x00\n"),
		[]byte("lsof: WARNING: can't opendir(/root): Permission denied"),
	)
	if err != nil || warning == "" {
		t.Fatalf("partial result warning=%q error=%v", warning, err)
	}
	if _, err := classifyLsofExit(2, nil, []byte("lsof: unsupported option")); !errors.Is(err, ErrProbe) {
		t.Fatalf("probe error=%v", err)
	}
}

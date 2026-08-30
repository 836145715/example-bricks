package everything

import "testing"

func TestClassify(t *testing.T) {
	loaded := ClassifyInput{DLLExists: true, DLLLoaded: true}
	tests := []struct {
		name  string
		input ClassifyInput
		want  HealthReason
	}{
		{name: "unsupported", input: ClassifyInput{Unsupported: true}, want: ReasonUnsupported},
		{name: "missing dll", input: ClassifyInput{}, want: ReasonMissingSDK},
		{name: "dll failed to load", input: ClassifyInput{DLLExists: true}, want: ReasonMissingSDK},
		{name: "ready", input: merge(loaded, ClassifyInput{IPCReady: true}), want: ReasonReady},
		{
			name:  "not installed",
			input: merge(loaded, ClassifyInput{LastError: ErrorIPC}),
			want:  ReasonNotInstalled,
		},
		{
			name: "installed but not running",
			input: merge(loaded, ClassifyInput{
				LastError:   ErrorIPC,
				InstallPath: `C:\Program Files\Everything\Everything.exe`,
			}),
			want: ReasonNotRunning,
		},
		{
			name: "indexing with install path",
			input: merge(loaded, ClassifyInput{
				InstallPath: `C:\Program Files\Everything\Everything.exe`,
			}),
			want: ReasonIndexing,
		},
		{
			name: "indexing without install path when IPC connected",
			input: merge(loaded, ClassifyInput{IPCConnected: true}),
			want: ReasonIndexing,
		},
		{
			name: "indexing without install path when last error is ok",
			input: loaded,
			want: ReasonIndexing,
		},
		{
			name: "running but ipc unavailable",
			input: merge(loaded, ClassifyInput{LastError: ErrorIPC, ProcessRunning: true}),
			want: ReasonIpcUnavailable,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := Classify(test.input); got != test.want {
				t.Fatalf("Classify() = %q, want %q", got, test.want)
			}
		})
	}
}

func merge(base ClassifyInput, overlay ClassifyInput) ClassifyInput {
	if overlay.DLLExists {
		base.DLLExists = true
	}
	if overlay.DLLLoaded {
		base.DLLLoaded = true
	}
	if overlay.IPCReady {
		base.IPCReady = true
	}
	if overlay.IPCConnected {
		base.IPCConnected = true
	}
	if overlay.LastError != 0 {
		base.LastError = overlay.LastError
	}
	if overlay.InstallPath != "" {
		base.InstallPath = overlay.InstallPath
	}
	if overlay.ProcessRunning {
		base.ProcessRunning = true
	}
	if overlay.Unsupported {
		base.Unsupported = true
	}
	return base
}

func TestReasonMessageNotInstalled(t *testing.T) {
	msg := ReasonMessage(ReasonNotInstalled)
	if msg == "" {
		t.Fatal("expected user-facing message")
	}
}

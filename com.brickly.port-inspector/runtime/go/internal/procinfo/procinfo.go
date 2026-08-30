package procinfo

import "errors"

var (
	ErrUnsupported  = errors.New("process ops unsupported on this platform")
	ErrNotFound     = errors.New("process not found")
	ErrSelf         = errors.New("refusing to stop the runtime process")
	ErrDetails      = errors.New("failed to read process details")
	ErrTerminate    = errors.New("failed to terminate process")
	ErrInvalidInput = errors.New("invalid process input")
	ErrAccess       = errors.New("access denied")
)

type Details struct {
	OK               bool    `json:"ok"`
	Platform         string  `json:"platform"`
	PID              uint32  `json:"pid"`
	ParentPID        *uint32 `json:"parentPid"`
	ProcessName      *string `json:"processName"`
	ExecutablePath   *string `json:"executablePath"`
	CommandLine      *string `json:"commandLine"`
	WorkingDirectory *string `json:"workingDirectory"`
	User             *string `json:"user"`
	State            *string `json:"state"`
	StartedAt        *string `json:"startedAt"`
	Elapsed          *string `json:"elapsed"`
	InspectedAt      string  `json:"inspectedAt"`
}

type StopResult struct {
	OK            bool   `json:"ok"`
	PID           uint32 `json:"pid"`
	ProcessName   string `json:"processName"`
	Force         bool   `json:"force"`
	AlreadyExited bool   `json:"alreadyExited"`
	Method        string `json:"method"`
	Platform      string `json:"platform"`
	KilledAt      string `json:"killedAt"`
}

type Snapshot struct {
	ProcessName    string
	ExecutablePath string
	StartedAt      string
}

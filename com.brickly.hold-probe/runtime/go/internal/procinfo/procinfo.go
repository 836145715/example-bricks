package procinfo

import "errors"

var (
	ErrUnsupported  = errors.New("process ops unsupported on this platform")
	ErrNotFound     = errors.New("process not found")
	ErrReused       = errors.New("process identity reused")
	ErrSelf         = errors.New("refusing to stop the runtime process")
	ErrDetails      = errors.New("failed to read process details")
	ErrTerminate    = errors.New("failed to terminate process")
	ErrInvalidInput = errors.New("invalid process input")
)

type Details struct {
	PID            uint32 `json:"pid"`
	StartKey       string `json:"startKey"`
	ProcessName    string `json:"processName"`
	ExecutablePath string `json:"executablePath"`
	CommandLine    string `json:"commandLine"`
	User           string `json:"user"`
	ParentPID      uint32 `json:"parentPid"`
	SessionID      uint32 `json:"sessionId"`
	StartedAt      string `json:"startedAt"`
	InspectedAt    string `json:"inspectedAt"`
}

type StopResult struct {
	OK            bool   `json:"ok"`
	PID           uint32 `json:"pid"`
	StartKey      string `json:"startKey"`
	ProcessName   string `json:"processName"`
	Force         bool   `json:"force"`
	AlreadyExited bool   `json:"alreadyExited"`
	StoppedAt     string `json:"stoppedAt"`
}

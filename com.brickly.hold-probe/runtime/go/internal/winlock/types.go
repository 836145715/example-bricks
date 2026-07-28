package winlock

import "errors"

var (
	ErrUnsupported = errors.New("hold probe is only supported on Windows")
	ErrAccess      = errors.New("access denied")
	ErrProbe       = errors.New("probe failed")
)

type Source string

const (
	SourceRestartManager Source = "restart-manager"
	SourceHandleScan     Source = "handle-scan"
	SourceProcessRef     Source = "process-ref"
)

type Holder struct {
	PID             uint32   `json:"pid"`
	StartKey        string   `json:"startKey"`
	ProcessName     string   `json:"processName"`
	ApplicationType string   `json:"applicationType"`
	Status          uint32   `json:"status"`
	Restartable     bool     `json:"restartable"`
	SessionID       uint32   `json:"sessionId"`
	StartedAt       string   `json:"startedAt"`
	Sources         []Source `json:"sources"`
}

type Result struct {
	Path     string   `json:"path"`
	Kind     string   `json:"kind"`
	Count    int      `json:"count"`
	Holders  []Holder `json:"holders"`
	DeepUsed bool     `json:"deepUsed"`
	Notes    []string `json:"notes,omitempty"`
	ProbedAt string   `json:"probedAt"`
}

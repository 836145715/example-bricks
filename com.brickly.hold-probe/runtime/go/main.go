package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"brickly/hold-probe/internal/pathnorm"
	"brickly/hold-probe/internal/procinfo"
	_ "brickly/hold-probe/internal/stdoutguard"
	"brickly/hold-probe/internal/winlock"
	brickly "github.com/836145715/brickly-sdk-go"
)


func main() {
	plugin := brickly.New()

	plugin.OnCommand("probe", handleProbe)
	plugin.OnCommand("process-info", handleProcessInfo)
	plugin.OnCommand("stop", handleStop)
	plugin.Start()
}

func handleProbe(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		Path string `json:"path"`
		Deep bool   `json:"deep"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", fmt.Sprintf("invalid probe input: %v", err))
	}
	_, _ = fmt.Fprintf(os.Stderr, "[hold-probe] probe request path=%q deep=%v\n", params.Path, params.Deep)
	target, err := pathnorm.Normalize(params.Path)
	if err != nil {
		return nil, mapError(err)
	}
	result, err := winlock.Probe(target.Path, string(target.Kind), params.Deep)
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "[hold-probe] probe error: %v\n", err)
		return nil, mapError(err)
	}
	_, _ = fmt.Fprintf(os.Stderr, "[hold-probe] probe response count=%d\n", result.Count)
	return result, nil
}

func handleProcessInfo(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	pid, startKey, _, err := decodeProcess(input, false)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	result, err := procinfo.GetDetails(pid, startKey)
	if err != nil {
		return nil, mapError(err)
	}
	return result, nil
}

func handleStop(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	pid, startKey, force, err := decodeProcess(input, true)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	result, err := procinfo.Stop(pid, startKey, force)
	if err != nil {
		return nil, mapError(err)
	}
	return result, nil
}

func decodeProcess(input json.RawMessage, withForce bool) (uint32, string, bool, error) {
	var params struct {
		PID      uint32 `json:"pid"`
		StartKey string `json:"startKey"`
		Force    bool   `json:"force"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return 0, "", false, fmt.Errorf("invalid process input: %w", err)
	}
	if params.PID == 0 {
		return 0, "", false, errors.New("pid must be a positive integer")
	}
	key := strings.TrimSpace(params.StartKey)
	if key == "" {
		return 0, "", false, errors.New("startKey is required")
	}
	if _, err := strconv.ParseUint(key, 10, 64); err != nil {
		return 0, "", false, errors.New("startKey must be a decimal uint64 string")
	}
	if !withForce {
		params.Force = false
	}
	return params.PID, key, params.Force, nil
}

func mapError(err error) error {
	switch {
	case errors.Is(err, pathnorm.ErrEmpty),
		errors.Is(err, pathnorm.ErrRelative),
		errors.Is(err, pathnorm.ErrInvalid),
		errors.Is(err, pathnorm.ErrUnsupported),
		errors.Is(err, procinfo.ErrInvalidInput),
		errors.Is(err, procinfo.ErrSelf):
		return brickly.NewBppError("INVALID_INPUT", err.Error())
	case errors.Is(err, pathnorm.ErrNotFound):
		return brickly.NewBppError("PATH_NOT_FOUND", err.Error())
	case errors.Is(err, pathnorm.ErrAccess), errors.Is(err, winlock.ErrAccess):
		return brickly.NewBppError("ACCESS_DENIED", err.Error())
	case errors.Is(err, winlock.ErrUnsupported), errors.Is(err, procinfo.ErrUnsupported):
		return brickly.NewBppError("UNSUPPORTED_PLATFORM", err.Error())
	case errors.Is(err, winlock.ErrProbe):
		return brickly.NewBppError("PROBE_FAILED", err.Error())
	case errors.Is(err, procinfo.ErrNotFound):
		return brickly.NewBppError("PROCESS_NOT_FOUND", err.Error())
	case errors.Is(err, procinfo.ErrReused):
		return brickly.NewBppError("PROCESS_REUSED", err.Error())
	case errors.Is(err, procinfo.ErrDetails):
		return brickly.NewBppError("PROCESS_DETAILS_FAILED", err.Error())
	case errors.Is(err, procinfo.ErrTerminate):
		return brickly.NewBppError("TERMINATE_FAILED", err.Error())
	default:
		return brickly.NewBppError("INTERNAL_ERROR", err.Error())
	}
}

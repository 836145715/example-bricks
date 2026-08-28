package main

import (
	"encoding/json"
	"errors"
	"fmt"

	"brickly/port-inspector/internal/nettable"
	"brickly/port-inspector/internal/procinfo"
	_ "brickly/port-inspector/internal/stdoutguard"
	brickly "github.com/836145715/brickly-sdk-go"
)


var buildStamp = "dev"

func main() {
	plugin := brickly.New()

	plugin.OnCommand("lookup", handleLookup)
	plugin.OnCommand("list", handleList)
	plugin.OnCommand("details", handleDetails)
	plugin.OnCommand("kill", handleKill)
	plugin.Start()
}

func handleLookup(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		Port     int    `json:"port"`
		Protocol string `json:"protocol"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", fmt.Sprintf("invalid lookup input: %v", err))
	}
	if params.Port < 1 || params.Port > 65535 {
		return nil, brickly.NewBppError("INVALID_INPUT", "port must be an integer between 1 and 65535")
	}
	port := params.Port
	result, err := nettable.List(nettable.Filter{
		Port:               &port,
		Protocol:           params.Protocol,
		IncludeEstablished: true,
		Limit:              2000,
	})
	if err != nil {
		return nil, mapError(err)
	}
	return result, nil
}

func handleList(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	var params struct {
		Query              string `json:"query"`
		Protocol           string `json:"protocol"`
		IncludeEstablished *bool  `json:"includeEstablished"`
		Limit              int    `json:"limit"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", fmt.Sprintf("invalid list input: %v", err))
	}
	include := true
	if params.IncludeEstablished != nil {
		include = *params.IncludeEstablished
	}
	result, err := nettable.List(nettable.Filter{
		Protocol:           params.Protocol,
		IncludeEstablished: include,
		Query:              params.Query,
		Limit:              params.Limit,
	})
	if err != nil {
		return nil, mapError(err)
	}
	return result, nil
}

func handleDetails(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	pid, _, err := decodeProcess(input, false)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	result, err := procinfo.GetDetails(pid)
	if err != nil {
		return nil, mapError(err)
	}
	return result, nil
}

func handleKill(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
	pid, force, err := decodeProcess(input, true)
	if err != nil {
		return nil, brickly.NewBppError("INVALID_INPUT", err.Error())
	}
	result, err := procinfo.Stop(pid, force)
	if err != nil {
		return nil, mapError(err)
	}
	return result, nil
}

func decodeProcess(input json.RawMessage, withForce bool) (uint32, bool, error) {
	var params struct {
		PID   uint32 `json:"pid"`
		Force bool   `json:"force"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return 0, false, fmt.Errorf("invalid process input: %w", err)
	}
	if params.PID == 0 {
		return 0, false, errors.New("pid must be a positive integer")
	}
	if !withForce {
		params.Force = false
	}
	return params.PID, params.Force, nil
}

func mapError(err error) error {
	switch {
	case errors.Is(err, nettable.ErrInvalid), errors.Is(err, procinfo.ErrInvalidInput), errors.Is(err, procinfo.ErrSelf):
		return brickly.NewBppError("INVALID_INPUT", err.Error())
	case errors.Is(err, nettable.ErrUnsupported), errors.Is(err, procinfo.ErrUnsupported):
		return brickly.NewBppError("UNSUPPORTED_PLATFORM", err.Error())
	case errors.Is(err, procinfo.ErrNotFound):
		return brickly.NewBppError("PROCESS_NOT_FOUND", err.Error())
	case errors.Is(err, procinfo.ErrAccess):
		return brickly.NewBppError("ACCESS_DENIED", err.Error())
	case errors.Is(err, procinfo.ErrTerminate):
		return brickly.NewBppError("TERMINATE_FAILED", err.Error())
	case errors.Is(err, procinfo.ErrDetails):
		return brickly.NewBppError("PROCESS_DETAILS_FAILED", err.Error())
	default:
		return brickly.NewBppError("INTERNAL_ERROR", err.Error())
	}
}

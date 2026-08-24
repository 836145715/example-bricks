package main

import (
	"encoding/json"

	brickly "github.com/836145715/brickly-sdk-go"
)

func asJSONValue(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func sendJSON(ctx *brickly.CommandContext, payload any) error {
	value, err := asJSONValue(payload)
	if err != nil {
		return err
	}
	return ctx.Send(value)
}

func sendSessionOpened(ctx *brickly.CommandContext, sessionID, hostID string) error {
	return sendJSON(ctx, map[string]any{
		"type": "session",
		"session": map[string]any{
			"sessionId": sessionID,
			"hostId":    hostID,
			"status":    "open",
		},
	})
}

func sendSessionData(ctx *brickly.CommandContext, sessionID string, visible []byte) error {
	return sendJSON(ctx, map[string]any{
		"type":      "data",
		"sessionId": sessionID,
		"encoding":  "base64",
		"bytes":     encodeBytes(visible),
	})
}

func sendSessionStatus(ctx *brickly.CommandContext, sessionID string, exitCode int) error {
	return sendJSON(ctx, map[string]any{
		"type":      "status",
		"sessionId": sessionID,
		"status":    "closed",
		"exitCode":  exitCode,
	})
}

func sendSessionCwd(ctx *brickly.CommandContext, sessionID, path string, pid int) error {
	if !validRemoteCwd(path) {
		return nil
	}
	payload := map[string]any{
		"type":      "cwd",
		"sessionId": sessionID,
		"path":      path,
	}
	if pid > 0 {
		payload["pid"] = pid
	}
	return sendJSON(ctx, payload)
}

func sendSftpProgress(ctx *brickly.CommandContext, progress transferProgress) error {
	payload, err := asJSONValue(progress)
	if err != nil {
		return err
	}
	record, _ := payload.(map[string]any)
	if record == nil {
		record = map[string]any{}
	}
	record["type"] = "progress"
	record["message"] = progress.Phase
	if progress.Percent != nil {
		record["progress"] = float64(*progress.Percent) / 100
	} else {
		record["progress"] = 0
	}
	return ctx.Send(record)
}

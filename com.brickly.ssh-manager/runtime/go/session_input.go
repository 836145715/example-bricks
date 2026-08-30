package main

import (
	"bytes"
	"encoding/json"
)

type sessionInput struct {
	Type string
	Data []byte
	Cols int
	Rows int
}

func applySessionInput(sessionID string, event any) {
	input, err := parseSessionInput(event)
	if err != nil {
		return
	}
	switch input.Type {
	case "data":
		_ = sessions.write(sessionID, input.Data)
		if containsCommandSubmit(input.Data) {
			sessions.scheduleCwd(sessionID, cwdAfterEnter)
		}
	case "resize":
		cols, rows := clampTermSize(input.Cols, input.Rows)
		_ = sessions.resize(sessionID, cols, rows)
	case "cwd":
		sessions.scheduleCwd(sessionID, 0)
	}
}

func parseSessionInput(event any) (sessionInput, error) {
	raw := asObject(event)
	if raw == nil {
		return sessionInput{}, newInputError("invalid session input")
	}
	switch asString(raw["type"]) {
	case "data":
		data, err := decodeSessionData(asString(raw["bytes"]))
		if err != nil {
			return sessionInput{}, err
		}
		return sessionInput{Type: "data", Data: data}, nil
	case "resize":
		return sessionInput{
			Type: "resize",
			Cols: asInt(raw["cols"]),
			Rows: asInt(raw["rows"]),
		}, nil
	case "cwd":
		return sessionInput{Type: "cwd"}, nil
	default:
		return sessionInput{}, newInputError("unknown session input")
	}
}

func containsCommandSubmit(data []byte) bool {
	return bytes.ContainsAny(data, "\r\n")
}

func asObject(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case json.RawMessage:
		var decoded any
		if json.Unmarshal(typed, &decoded) != nil {
			return nil
		}
		return asObject(decoded)
	default:
		data, err := json.Marshal(value)
		if err != nil {
			return nil
		}
		var decoded map[string]any
		if json.Unmarshal(data, &decoded) != nil {
			return nil
		}
		return decoded
	}
}

func asString(value any) string {
	text, _ := value.(string)
	return text
}

func asInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case float32:
		return int(typed)
	case json.Number:
		n, err := typed.Int64()
		if err != nil {
			return 0
		}
		return int(n)
	default:
		return 0
	}
}

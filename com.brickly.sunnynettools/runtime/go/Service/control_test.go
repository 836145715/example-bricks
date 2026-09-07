package Service

import (
	"encoding/json"
	"testing"
)

func TestParseControlRequest(t *testing.T) {
	op, args, err := ParseControlRequest(map[string]any{
		"op":   "GetPort",
		"args": []any{8080},
	})
	if err != nil {
		t.Fatal(err)
	}
	if op != "GetPort" {
		t.Fatalf("op=%s", op)
	}
	if len(args) != 1 {
		t.Fatalf("args len=%d", len(args))
	}
	var port int
	if err := json.Unmarshal(args[0], &port); err != nil {
		t.Fatal(err)
	}
	if port != 8080 {
		t.Fatalf("port=%d", port)
	}
}

func TestParseControlRequestMissingOp(t *testing.T) {
	if _, _, err := ParseControlRequest(map[string]any{"args": []any{}}); err == nil {
		t.Fatal("expected error")
	}
}

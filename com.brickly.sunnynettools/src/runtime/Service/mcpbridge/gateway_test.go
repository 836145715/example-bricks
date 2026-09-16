package mcpbridge

import (
	"errors"
	"testing"

	"changeme/Service/mcpcatalog"
)

func TestGatewayList(t *testing.T) {
	_, result, err := gatewayCall(NewHost(), "rules", map[string]any{"op": "list"})
	if err != nil {
		t.Fatal(err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result type %T", result)
	}
	if m["domain"] != "rules" {
		t.Fatalf("domain %v", m["domain"])
	}
	actions, ok := m["actions"].([]map[string]any)
	if !ok {
		t.Fatalf("actions type %T", m["actions"])
	}
	if len(actions) == 0 {
		t.Fatal("no actions")
	}
}

func TestGatewayDescribe(t *testing.T) {
	_, result, err := gatewayCall(NewHost(), "rules", map[string]any{"op": "describe", "action": "replace.get"})
	if err != nil {
		t.Fatal(err)
	}
	def, ok := result.(mcpcatalog.ActionDefinition)
	if !ok {
		t.Fatalf("result type %T", result)
	}
	if def.LegacyOp != "config_get_replace" {
		t.Fatalf("legacyOp %q", def.LegacyOp)
	}
	if def.InputSchema == nil {
		t.Fatal("missing inputSchema")
	}
}

func TestGatewayExecute(t *testing.T) {
	var invokedOp string
	var invokedArgs map[string]any
	BackendInvoke = func(op string, args map[string]any) (any, error) {
		invokedOp = op
		invokedArgs = args
		return map[string]any{"ok": true}, nil
	}
	defer func() { BackendInvoke = nil }()

	_, result, err := gatewayCall(NewHost(), "rules", map[string]any{
		"op":     "execute",
		"action": "host.add",
		"params": map[string]any{"lod": "a.com", "new": "1.2.3.4"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if invokedOp != "config_host_add" {
		t.Fatalf("invoked op %q", invokedOp)
	}
	if invokedArgs["lod"] != "a.com" {
		t.Fatalf("args %v", invokedArgs)
	}
	m, ok := result.(map[string]any)
	if !ok || m["ok"] != true {
		t.Fatalf("result %v", result)
	}
}

func TestGatewayExecuteValidation(t *testing.T) {
	BackendInvoke = func(op string, args map[string]any) (any, error) {
		return nil, errors.New("should not be called")
	}
	defer func() { BackendInvoke = nil }()

	// 未知动作应报错，且不触发 BackendInvoke
	_, _, err := gatewayCall(NewHost(), "rules", map[string]any{"op": "execute", "action": "no.such"})
	if err == nil {
		t.Fatal("expected error for unknown action")
	}
	// 未知 op 应报错
	_, _, err = gatewayCall(NewHost(), "rules", map[string]any{"op": "boom"})
	if err == nil {
		t.Fatal("expected error for unknown op")
	}
}

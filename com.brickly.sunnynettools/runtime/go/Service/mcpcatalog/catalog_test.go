package mcpcatalog

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSupportedOpsJSONEnvelope(t *testing.T) {
	raw := SupportedOpsJSON()
	var env struct {
		Version      int                  `json:"version"`
		Ops          []string             `json:"ops"`
		Capabilities []BridgeOpCapability `json:"capabilities"`
	}
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		t.Fatal(err)
	}
	if env.Version != 2 {
		t.Fatalf("version: %d", env.Version)
	}
	if len(env.Ops) == 0 || len(env.Capabilities) == 0 {
		t.Fatalf("empty ops=%d caps=%d", len(env.Ops), len(env.Capabilities))
	}
	if len(env.Ops) != len(env.Capabilities) {
		t.Fatalf("ops len %d vs caps len %d", len(env.Ops), len(env.Capabilities))
	}
	for i := range env.Ops {
		if env.Ops[i] != env.Capabilities[i].Op {
			t.Fatalf("mismatch at %d: %q vs %q", i, env.Ops[i], env.Capabilities[i].Op)
		}
		if env.Capabilities[i].Description == "" {
			t.Fatalf("empty description for %q", env.Capabilities[i].Op)
		}
		if strings.TrimSpace(env.Capabilities[i].Returns) == "" {
			t.Fatalf("empty returns for %q", env.Capabilities[i].Op)
		}
	}
}

func TestMainRowNoteSetInputSchemaHasRowIDs(t *testing.T) {
	schema := ToolInputSchema("main_row_note_set")
	if schema == nil {
		t.Fatal("expected schema for main_row_note_set")
	}
	b, err := json.Marshal(schema)
	if err != nil {
		t.Fatal(err)
	}
	raw := string(b)
	if !strings.Contains(raw, "rowIds") {
		t.Fatalf("schema missing rowIds: %s", raw)
	}
	if !strings.Contains(raw, "note") {
		t.Fatalf("schema missing note: %s", raw)
	}
}

func TestBridgeMCPToolsMainRowNoteSetDescription(t *testing.T) {
	// 扁平工具已移除：main_row_note_set 作为领域动作存在，通过 describe 返回详细描述。
	tools := BridgeMCPTools()
	found := false
	for _, tt := range tools {
		if tt.Domain != "" && tt.Op == "" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("no domain gateway tool registered")
	}
	def, ok := ActionByLegacyOp("main_row_note_set")
	if !ok {
		t.Fatal("main_row_note_set action not found")
	}
	if def.Domain != "traffic" {
		t.Fatalf("domain %q", def.Domain)
	}
	if def.UseWhen == "" {
		t.Fatal("empty useWhen description")
	}
}

func TestBridgeMCPTools(t *testing.T) {
	tools := BridgeMCPTools()
	if len(tools) != len(domainDefinitions) {
		t.Fatalf("gateway tools %d vs domains %d", len(tools), len(domainDefinitions))
	}
	for i, tt := range tools {
		if tt.Domain == "" || tt.Op != "" {
			t.Fatalf("idx %d: expected gateway tool, got domain=%q op=%q", i, tt.Domain, tt.Op)
		}
		if tt.MCPName == "" || tt.Description == "" {
			t.Fatalf("idx %d: empty name/description", i)
		}
		if tt.Title == "" {
			t.Fatalf("idx %d: empty title for %q", i, tt.Domain)
		}
		if _, ok := FindDomain(tt.Domain); !ok {
			t.Fatalf("idx %d: unknown domain %q", i, tt.Domain)
		}
	}
}

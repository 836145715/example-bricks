package Service

import (
	"testing"

	"changeme/Service/mcpcatalog"
)

func TestMCPRegistryMatchesCatalog(t *testing.T) {
	ensureMCPRegistryConsistency()
	if _, ok := mcpRegistry["generate_builtin_code"]; ok {
		t.Fatal("generate_builtin_code handler must stay removed")
	}
	if len(mcpRegistry) != len(mcpcatalog.SupportedBridgeOps) {
		t.Fatalf("registry %d vs catalog %d", len(mcpRegistry), len(mcpcatalog.SupportedBridgeOps))
	}
}

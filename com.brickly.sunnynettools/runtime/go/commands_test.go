package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPublicCommandTableHasNoEscapeHatch(t *testing.T) {
	if _, ok := publicCommandTable["call"]; ok {
		t.Fatal("public command table must not expose call")
	}
	if _, ok := publicCommandTable["clipboard-read"]; ok {
		t.Fatal("clipboard is platform API, not a public command")
	}
	if _, ok := publicCommandTable["is-dark"]; ok {
		t.Fatal("UI chrome must not be a public command")
	}
	if _, ok := publicCommandTable["open-tool-window"]; ok {
		t.Fatal("open-tool-window is registered separately, not in the public table")
	}
	if publicCommandTable["start-capture"] != "Start" {
		t.Fatal("start-capture mapping")
	}
	if publicCommandTable["export-cert"] != "ExportCert" {
		t.Fatal("export-cert mapping")
	}
	if publicCommandTable["mcp-status"] != "MCPStatusJSON" {
		t.Fatal("mcp-status mapping")
	}
}

func TestManifestDeclaresPublicSurfaceOnly(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Commands []struct {
			ID     string `json:"id"`
			Window string `json:"window"`
		} `json:"commands"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for _, c := range doc.Commands {
		if c.ID == "call" {
			t.Fatal("manifest must not declare call")
		}
		ids[c.ID] = c.Window
	}
	for id := range publicCommandTable {
		if _, ok := ids[id]; !ok {
			t.Fatalf("manifest missing public command %s", id)
		}
	}
	if ids["open-tool-window"] != "standalone" {
		t.Fatal("open-tool-window must declare window=standalone")
	}
	for _, extra := range []string{"dialog", "capture-stream", "control-stream", "capture-count", "capture-peek", "capture-ids", "capture-filter"} {
		if _, ok := ids[extra]; !ok {
			t.Fatalf("manifest missing %s", extra)
		}
	}
}

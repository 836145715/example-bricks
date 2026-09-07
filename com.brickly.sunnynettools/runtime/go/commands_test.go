package main

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func publicCommandSet() map[string]bool {
	out := make(map[string]bool, len(publicCommandIDs))
	for _, id := range publicCommandIDs {
		out[id] = true
	}
	return out
}

func TestPublicCommandTableHasNoEscapeHatch(t *testing.T) {
	set := publicCommandSet()
	if set["call"] {
		t.Fatal("public command table must not expose call")
	}
	if set["clipboard-read"] || set["clipboard-read-all"] {
		t.Fatal("clipboard is platform/UI API, not a public command")
	}
	if set["is-dark"] {
		t.Fatal("UI chrome must not be a public command")
	}
	if set["open-tool-window"] {
		t.Fatal("open-tool-window is registered separately, not in the public table")
	}
	if !set["start-capture"] {
		t.Fatal("start-capture mapping")
	}
	if !set["export-cert"] {
		t.Fatal("export-cert mapping")
	}
	if !set["mcp-status"] {
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
			ID        string `json:"id"`
			Window    string `json:"window"`
			Hidden    bool   `json:"hidden"`
			Mode      string `json:"mode"`
			Execution string `json:"execution"`
			IO        struct {
				OutputEvents []struct {
					Name string `json:"name"`
				} `json:"outputEvents"`
			} `json:"io"`
		} `json:"commands"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	ids := map[string]struct {
		window string
		hidden bool
	}{}
	visible := 0
	socketNameRe := regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
	for _, c := range doc.Commands {
		if c.ID == "call" {
			t.Fatal("manifest must not declare call")
		}
		if c.ID == "control-stream" {
			t.Fatal("manifest must not declare leftover control session")
		}
		ids[c.ID] = struct {
			window string
			hidden bool
		}{c.Window, c.Hidden}
		if !c.Hidden {
			visible++
		}
		for _, ev := range c.IO.OutputEvents {
			if !socketNameRe.MatchString(ev.Name) {
				t.Errorf("command %s outputEvent %q fails socket name pattern", c.ID, ev.Name)
			}
		}
	}
	if visible != len(publicCommandIDs) {
		t.Fatalf("visible commands %d, want %d", visible, len(publicCommandIDs))
	}
	for _, id := range publicCommandIDs {
		info, ok := ids[id]
		if !ok {
			t.Fatalf("manifest missing public command %s", id)
		}
		if info.hidden {
			t.Fatalf("public command %s must not be hidden", id)
		}
	}
	for _, id := range []string{"is-dark", "get-tour", "get-session", "dialog", "capture-filter", "theme"} {
		if _, ok := ids[id]; ok {
			t.Fatalf("%s must not be a catalog command; it goes through ui-rpc", id)
		}
	}
	if ids["open-tool-window"].window != "standalone" || !ids["open-tool-window"].hidden {
		t.Fatal("open-tool-window must be hidden standalone")
	}
	if _, ok := ids["capture-stream"]; !ok || !ids["capture-stream"].hidden {
		t.Fatal("capture-stream must be hidden")
	}
	var uiRpc struct {
		hidden    bool
		mode      string
		execution string
	}
	for _, c := range doc.Commands {
		if c.ID == "ui-rpc" {
			uiRpc.hidden = c.Hidden
			uiRpc.mode = c.Mode
			uiRpc.execution = c.Execution
		}
	}
	if !uiRpc.hidden || uiRpc.mode != "interact" || uiRpc.execution != "parallel" {
		t.Fatalf("ui-rpc must be hidden interact parallel, got hidden=%v mode=%q execution=%q", uiRpc.hidden, uiRpc.mode, uiRpc.execution)
	}
	if got, want := len(doc.Commands), len(publicCommandIDs)+3; got != want {
		t.Fatalf("manifest commands %d, want %d (12 public + capture-stream + ui-rpc + open-tool-window)", got, want)
	}
}

func TestDispatchUiRpcEnvelope(t *testing.T) {
	prev, had := commandHandlers["get-tour"]
	commandHandlers["get-tour"] = func(input json.RawMessage) (any, error) {
		var req struct {
			NewTour bool `json:"newTour"`
		}
		if err := json.Unmarshal(input, &req); err != nil {
			return nil, err
		}
		return map[string]any{"newTour": req.NewTour}, nil
	}
	t.Cleanup(func() {
		if had {
			commandHandlers["get-tour"] = prev
			return
		}
		delete(commandHandlers, "get-tour")
	})
	out, err := dispatchUiRpc(map[string]any{"id": "get-tour", "input": map[string]any{"newTour": true}})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := out.(map[string]any)
	if got["newTour"] != true {
		t.Fatalf("get-tour via ui-rpc: %#v", out)
	}
	if _, err := dispatchUiRpc(map[string]any{"id": "ui-rpc"}); err == nil {
		t.Fatal("ui-rpc must not recurse")
	}
	if _, err := dispatchUiRpc(map[string]any{"id": "missing-cmd"}); err == nil {
		t.Fatal("unknown id must fail")
	}
}

func TestSourceHasNoWailsShim(t *testing.T) {
	roots := []string{
		filepath.Join("..", "..", "frontend", "src"),
		".",
	}
	needles := []string{"wailsio/runtime", "Call.ByID", "wails-shim", "InvokeMethod", "control-stream", "Config.AppList"}
	for _, root := range roots {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				base := d.Name()
				if base == "node_modules" || base == ".git" {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasSuffix(d.Name(), "_test.go") {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".go" && ext != ".js" && ext != ".ts" && ext != ".vue" && ext != ".mjs" {
				return nil
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			text := string(raw)
			for _, needle := range needles {
				if strings.Contains(text, needle) {
					t.Errorf("%s contains %q", path, needle)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

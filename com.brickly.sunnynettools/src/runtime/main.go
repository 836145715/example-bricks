package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"

	_ "changeme/internal/stdoutguard"
	brickly "github.com/836145715/brickly-sdk-go"

	"changeme/Service"
	"changeme/Service/Config"
	"changeme/Service/HookKeys"
	"changeme/Service/mcp"
	"github.com/sqweek/dialog"
)

var (
	Server *Service.AppMain
	plugin *brickly.Runtime
)

func init() {
	plugin = brickly.New()
	Config.EventPublisher = func(window, name string, args []any) {
		payload := map[string]any{"window": window, "name": name, "args": args}
		if err := plugin.Events.Publish("sunnynet:"+name, payload); err != nil {
			plugin.Info("publish event failed: "+err.Error(), nil)
		}
		Service.BroadcastToolWindowEvent("sunnynet:"+name, payload)
	}
	Service.NotifyUI = Config.Publish
}

func bindNamedHandler(id string, fn func(input json.RawMessage) (any, error)) {
	commandHandlers[id] = fn
}

// captureStreamAdapter 把 brickly 的 CommandContext 适配为 Service 侧的最小接口。
type captureStreamAdapter struct{ ctx *brickly.CommandContext }

func (a captureStreamAdapter) Send(ev any) error { return a.ctx.Send(ev) }

func (a captureStreamAdapter) OnEvent(fn func(ev any)) error {
	return a.ctx.OnEvent(func(event any) { fn(event) })
}

func (a captureStreamAdapter) Closed() <-chan struct{} { return a.ctx.Closed() }

func openFileDialog(kind, title string, filters []string) (string, error) {
	if kind == "open-dir" {
		d := dialog.Directory()
		if title != "" {
			d = d.Title(title)
		}
		return d.Browse()
	}
	d := dialog.File()
	if title != "" {
		d = d.Title(title)
	}
	if len(filters) > 0 {
		d = d.Filter(filters[0], filters[0])
	}
	if kind == "save" {
		return d.Save()
	}
	return d.Load()
}

func handleDialogJSON(input json.RawMessage) (any, error) {
	var req struct {
		Kind    string `json:"kind"`
		Options struct {
			Title   string   `json:"title"`
			Filters []string `json:"filters"`
		} `json:"options"`
	}
	_ = json.Unmarshal(input, &req)
	path, err := openFileDialog(req.Kind, req.Options.Title, req.Options.Filters)
	if err != nil {
		return map[string]any{"path": ""}, nil
	}
	return map[string]any{"path": path}, nil
}

func debugLog(format string, args ...any) {
	f, err := os.OpenFile(filepath.Join(".", "runtime-debug.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, time.Now().Format("15:04:05.000")+" "+format+"\n", args...)
}

func main() {
	defer func() {
		if r := recover(); r != nil {
			debugLog("PANIC: %v\n%s", r, debug.Stack())
			panic(r)
		}
	}()
	debugLog("boot go=%s", runtime.Version())

	debugLog("service init begin")
	Server = Service.NewAppServer()
	debugLog("service init done")
	Service.SetMCPServer(Server)
	mcp.InitBridge(Service.MCPBridgeInvoke)
	HookKeys.RegisterKeys(Config.Config.Keys, Server.CallKeys)

	debugLog("commands registered, calling Start")

	plugin.OnCommand("ui-rpc", func(ctx *brickly.CommandContext, _ json.RawMessage) (any, error) {
		if err := ctx.Context().Err(); err != nil {
			return nil, err
		}
		if err := ctx.HandleRequests(func(req any, _ context.Context) (any, error) {
			return dispatchUiRpc(req)
		}, 32); err != nil {
			return nil, err
		}
		<-ctx.Closed()
		return map[string]any{"ok": true}, nil
	})

	plugin.OnCommand("capture-stream", func(ctx *brickly.CommandContext, _ json.RawMessage) (any, error) {
		if err := ctx.Context().Err(); err != nil {
			return nil, err
		}
		Server.CaptureStream(captureStreamAdapter{ctx: ctx})
		return map[string]any{"ok": true}, nil
	})

	plugin.OnCommand("open-tool-window", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		if err := ctx.Context().Err(); err != nil {
			return nil, err
		}
		var req struct {
			Name string `json:"name"`
			Open *bool  `json:"open"`
			Args string `json:"args"`
		}
		_ = json.Unmarshal(input, &req)
		open := true
		if req.Open != nil {
			open = *req.Open
		}
		Server.CallTools(req.Name, open, req.Args)
		return map[string]any{"ok": true}, nil
	})

	registerCommands()
	Service.SetCaptureServer(Server)
	Service.RegisterCaptureCommands(bindNamedHandler)
	commandHandlers["dialog"] = handleDialogJSON

	plugin.OnShutdown(func() error {
		if Server != nil {
			Server.ExitCleanup()
		}
		return nil
	})

	plugin.OnReady(func() error {
		persistConfig := func(doc []byte) {
			var value any
			if err := json.Unmarshal(doc, &value); err != nil {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := plugin.Storage.KV.Set(ctx, "sunnynet-config", value); err != nil {
				plugin.Info("persist config failed: "+err.Error(), nil)
			}
		}
		Config.PersistSave = persistConfig
		Config.PersistClear = func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = plugin.Storage.KV.Delete(ctx, "sunnynet-config")
		}
		Config.Config.Save()
		Service.PlatformClipboardRead = func() (string, error) {
			snap, err := plugin.Platform.Clipboard.ReadContent()
			if err != nil {
				return "", err
			}
			return Service.ClipboardTextFromSnapshot(map[string]any(snap)), nil
		}
		Service.PlatformClipboardWrite = func(text string) error {
			_, err := plugin.Platform.Clipboard.SetContent(brickly.ClipboardContent{
				"kind": "text",
				"text": text,
			})
			return err
		}
		return nil
	})

	Service.CreateBodyResource = func(name string, data []byte) (any, error) {
		handle, err := plugin.CreateResource(data, &brickly.ResourceCreateOptions{
			Name:     name,
			MimeType: "application/octet-stream",
		})
		if err != nil {
			return nil, err
		}
		return handle.Ref, nil
	}

	Service.InstallProcessExitHooks(func() {
		if Server != nil {
			Server.ExitCleanup()
		}
	})

	if err := plugin.Start(); err != nil {
		debugLog("Start failed: %v", err)
		if Server != nil {
			Server.ExitCleanup()
		}
		os.Exit(1)
	}
	if Server != nil {
		Server.ExitCleanup()
	}
	debugLog("Start returned (runtime exited)")
}

package main

import (
	"encoding/json"
	"strings"

	"changeme/Service"
	Session "changeme/internal/session"
	brickly "github.com/836145715/brickly-sdk-go"
)

var commandHandlers = map[string]func(json.RawMessage) (any, error){}

func dispatchNamedCommand(id string, input json.RawMessage) (any, error) {
	fn, ok := commandHandlers[id]
	if !ok {
		return nil, brickly.NewBppError("NOT_FOUND", "unknown command: "+id)
	}
	return fn(input)
}

func dispatchUiRpc(req any) (any, error) {
	raw, err := json.Marshal(req)
	if err != nil {
		return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
	}
	var env struct {
		ID    string          `json:"id"`
		Input json.RawMessage `json:"input"`
	}
	if err := json.Unmarshal(raw, &env); err != nil || strings.TrimSpace(env.ID) == "" {
		return nil, brickly.NewBppError("BAD_REQUEST", "ui-rpc 需要 {id, input}")
	}
	switch env.ID {
	case "ui-rpc", "capture-stream", "open-tool-window":
		return nil, brickly.NewBppError("NOT_FOUND", "unknown command: "+env.ID)
	}
	if len(env.Input) == 0 || string(env.Input) == "null" {
		env.Input = json.RawMessage("{}")
	}
	return dispatchNamedCommand(env.ID, env.Input)
}

// publicCommandIDs 是对外可见的命令面（manifest 不 hidden）。
// 会话/主题等走 hidden interact ui-rpc 的 session.request，不进清单。
var publicCommandIDs = []string{
	"start-capture", "stop-capture", "capture-status", "capture-error",
	"get-port", "set-port", "set-system-proxy", "clear-system-proxy",
	"export-cert", "mcp-status", "mcp-enable", "mcp-disable",
}

func decodeJSON(input json.RawMessage, dest any) error {
	if len(input) == 0 || string(input) == "null" {
		return nil
	}
	return json.Unmarshal(input, dest)
}

func registerCommands() {
	expose := make(map[string]bool, len(publicCommandIDs))
	for _, id := range publicCommandIDs {
		expose[id] = true
	}
	on := func(id string, fn func(input json.RawMessage) (any, error)) {
		commandHandlers[id] = fn
		if !expose[id] {
			return
		}
		plugin.OnCommand(id, func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
			if err := ctx.Context().Err(); err != nil {
				return nil, err
			}
			return fn(input)
		})
	}

	on("start-capture", func(json.RawMessage) (any, error) {
		Server.Start()
		return map[string]any{"ok": true}, nil
	})
	on("stop-capture", func(json.RawMessage) (any, error) {
		Server.Shutdown()
		return map[string]any{"ok": true}, nil
	})
	on("capture-status", func(json.RawMessage) (any, error) {
		return Server.AppCheckSunnyNet(), nil
	})
	on("capture-error", func(json.RawMessage) (any, error) {
		return Server.GetError(), nil
	})
	on("capture-version", func(json.RawMessage) (any, error) {
		return Server.AppVersion(), nil
	})
	on("get-port", func(json.RawMessage) (any, error) {
		return Server.GetPort(), nil
	})
	on("set-port", func(input json.RawMessage) (any, error) {
		var req struct {
			Port    int  `json:"port"`
			NoStart bool `json:"noStart"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.SetPort(req.Port, req.NoStart), nil
	})
	on("is-port-set", func(json.RawMessage) (any, error) {
		return Server.AppIsSetPort(), nil
	})
	on("set-system-proxy", func(json.RawMessage) (any, error) {
		return Server.SetIEProxy(), nil
	})
	on("clear-system-proxy", func(json.RawMessage) (any, error) {
		return Server.CancelIEProxy(), nil
	})
	on("set-working", func(input json.RawMessage) (any, error) {
		var req struct {
			Working bool `json:"working"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetWorking(req.Working)
		return map[string]any{"ok": true}, nil
	})
	on("goos", func(json.RawMessage) (any, error) {
		return Server.GOOS(), nil
	})
	on("get-session", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int `json:"theology"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetHTTPSession(req.Theology), nil
	})
	on("get-request-body", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int  `json:"theology"`
			GetAll   bool `json:"getAll"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetHTTPRequestBody(req.Theology, req.GetAll), nil
	})
	on("get-response-body", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int  `json:"theology"`
			GetAll   bool `json:"getAll"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetHTTPResponseBody(req.Theology, req.GetAll), nil
	})
	on("get-session-message-body", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology  int `json:"theology"`
			MessageId int `json:"messageId"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetSessionMessageBody(req.Theology, req.MessageId), nil
	})
	on("get-all-stream", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int `json:"theology"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetAllStream(req.Theology), nil
	})
	on("delete-sessions", func(input json.RawMessage) (any, error) {
		var req struct {
			Ids []int `json:"ids"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.AppDeleteSession(req.Ids)
		return map[string]any{"ok": true}, nil
	})
	on("clear-sessions", func(json.RawMessage) (any, error) {
		Server.ClearAllSession()
		return map[string]any{"ok": true}, nil
	})
	on("find-sessions", func(input json.RawMessage) (any, error) {
		var req struct {
			Info *Service.FindInfo `json:"info"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.FindSession(req.Info), nil
	})
	on("export-sessions", func(input json.RawMessage) (any, error) {
		var req struct {
			List     []int  `json:"list"`
			SavePath string `json:"savePath"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.AppExport(req.List, req.SavePath), nil
	})
	on("import-sessions", func(input json.RawMessage) (any, error) {
		var req struct {
			FilePath string `json:"filePath"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		errStr, list := Server.AppImport(req.FilePath)
		return []any{errStr, list}, nil
	})
	on("resend-request", func(input json.RawMessage) (any, error) {
		var req struct {
			Id        int `json:"id"`
			Count     int `json:"count"`
			BreakMode int `json:"breakMode"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.AppResendRequest(req.Id, req.Count, req.BreakMode)
		return map[string]any{"ok": true}, nil
	})
	on("update-note", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int    `json:"theology"`
			Note     string `json:"note"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.UpdateNote(req.Theology, req.Note)
		return map[string]any{"ok": true}, nil
	})
	on("active-send", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology     int    `json:"theology"`
			IsSendServer bool   `json:"isSendServer"`
			SendType     string `json:"sendType"`
			WsType       int    `json:"wsType"`
			Body         []byte `json:"body"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.SessionActiveSend(req.Theology, req.IsSendServer, req.SendType, req.WsType, req.Body), nil
	})
	on("disconnect-tcp", func(input json.RawMessage) (any, error) {
		var req struct {
			Ids []int           `json:"ids"`
			Id  json.RawMessage `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		ids := req.Ids
		if len(ids) == 0 && len(req.Id) > 0 {
			var many []int
			var one int
			if json.Unmarshal(req.Id, &many) == nil {
				ids = many
			} else if json.Unmarshal(req.Id, &one) == nil {
				ids = []int{one}
			}
		}
		Server.AppDisconnectTCPRequest(ids)
		return map[string]any{"ok": true}, nil
	})
	on("set-break-mode", func(input json.RawMessage) (any, error) {
		var req struct {
			Working uint32 `json:"working"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetBreakMode(req.Working)
		return map[string]any{"ok": true}, nil
	})
	on("set-request-next-break-mode", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int    `json:"theology"`
			Working  uint32 `json:"working"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetRequestNextBreakMode(req.Theology, req.Working)
		return map[string]any{"ok": true}, nil
	})
	on("update-http-request", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int                         `json:"theology"`
			Request  *Session.HttpSessionRequest `json:"request"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.UpdateHttpRequest(req.Theology, req.Request)
		return map[string]any{"ok": true}, nil
	})
	on("update-http-response", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int                          `json:"theology"`
			Response *Session.HttpSessionResponse `json:"response"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.UpdateHttpResponse(req.Theology, req.Response)
		return map[string]any{"ok": true}, nil
	})
	on("export-cert", func(input json.RawMessage) (any, error) {
		var req struct {
			Path string `json:"path"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ExportCert(req.Path), nil
	})
	on("list-processes", func(json.RawMessage) (any, error) {
		return Server.GetAllProcessesList(), nil
	})
	on("process-add-name", func(input json.RawMessage) (any, error) {
		var req struct {
			Name string `json:"name"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ProcessAddName(req.Name)
		return map[string]any{"ok": true}, nil
	})
	on("process-del-name", func(input json.RawMessage) (any, error) {
		var req struct {
			Name string `json:"name"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ProcessDelName(req.Name)
		return map[string]any{"ok": true}, nil
	})
	on("process-add-pid", func(input json.RawMessage) (any, error) {
		var req struct {
			Pid int `json:"pid"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ProcessAddPid(req.Pid)
		return map[string]any{"ok": true}, nil
	})
	on("process-del-pid", func(input json.RawMessage) (any, error) {
		var req struct {
			Pid int `json:"pid"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ProcessDelPid(req.Pid)
		return map[string]any{"ok": true}, nil
	})
	on("process-any", func(input json.RawMessage) (any, error) {
		var req struct {
			Open        bool `json:"open"`
			StopNetwork bool `json:"stopNetwork"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ProcessAny(req.Open, req.StopNetwork)
		return map[string]any{"ok": true}, nil
	})
	on("load-device", func(input json.RawMessage) (any, error) {
		var req struct {
			Mode int `json:"mode"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.LoadDevice(req.Mode), nil
	})
	on("set-device-stop-update", func(input json.RawMessage) (any, error) {
		var req struct {
			Stop bool `json:"stop"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetDeviceStopUpdate(req.Stop)
		return map[string]any{"ok": true}, nil
	})
	on("mcp-status", func(json.RawMessage) (any, error) {
		return Server.MCPStatusJSON(), nil
	})
	on("mcp-list-ops", func(json.RawMessage) (any, error) {
		return Server.MCPListOpsJSON(), nil
	})
	on("mcp-enable", func(input json.RawMessage) (any, error) {
		var req struct {
			Port int `json:"port"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.MCPEnable(req.Port), nil
	})
	on("mcp-disable", func(json.RawMessage) (any, error) {
		return Server.MCPDisable(), nil
	})

	registerUICommands(on)
}

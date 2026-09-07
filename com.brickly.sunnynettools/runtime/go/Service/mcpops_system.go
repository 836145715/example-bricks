package Service

import (
	"encoding/json"
	"errors"

	"changeme/Service/mcp"
	"changeme/Service/mcpcatalog"
)

func init() {
	registerMCPOps("system", map[string]mcpOpHandler{
		"ping": func(app MCPCore, args map[string]any) (any, error) {
			return map[string]any{"pong": true}, nil
		},
		"list_supported_ops": func(app MCPCore, args map[string]any) (any, error) {
			return json.RawMessage(mcpcatalog.SupportedOpsJSON()), nil
		},
		"get_status": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeGetStatus(app), nil
		},
		"engine_start": func(app MCPCore, args map[string]any) (any, error) {
			a := argsMap(args)
			port := argInt(a, "port", app.GetPort())
			if port <= 0 {
				port = 2021
			}
			if msg := app.SetPort(port, false); msg != "" {
				return nil, errors.New(msg)
			}
			app.Start()
			if app.GetError() != "" {
				return nil, errors.New(app.GetError())
			}
			if argBool(a, "useSystemProxy", false) {
				if !app.SetIEProxy() {
					return nil, errors.New("设置系统代理失败")
				}
				emitMCPMain("systemproxy", "set")
			}
			emitMCPMainJSON("engineStatus", map[string]any{
				"running": true,
				"port":    app.GetPort(),
				"error":   app.GetError(),
			})
			return map[string]any{"ok": true, "port": app.GetPort()}, nil
		},
		"engine_stop": func(app MCPCore, args map[string]any) (any, error) {
			app.Shutdown()
			emitMCPMainJSON("engineStatus", map[string]any{"running": false})
			return map[string]any{"ok": true}, nil
		},
		"engine_apply_advanced": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeEngineApplyAdvanced(app, argsMap(args))
		},
		"config_reapply_engine": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeReapplyEngine(app)
		},
		"capture_hide": func(app MCPCore, args map[string]any) (any, error) {
			app.SetWorking(true)
			emitMCPMain("home", "stop")
			return map[string]any{"ok": true}, nil
		},
		"capture_show": func(app MCPCore, args map[string]any) (any, error) {
			app.SetWorking(false)
			emitMCPMain("home", "start")
			return map[string]any{"ok": true}, nil
		},
		"system_proxy_enable": func(app MCPCore, args map[string]any) (any, error) {
			res := mcp.ProxyEnable()
			if res != "" && res != "系统代理已开启" {
				return nil, errors.New(res)
			}
			if !app.SetIEProxy() {
				return nil, errors.New("设置系统代理失败")
			}
			emitMCPMain("systemproxy", "set")
			return map[string]any{"ok": true}, nil
		},
		"system_proxy_disable": func(app MCPCore, args map[string]any) (any, error) {
			res := mcp.ProxyDisable()
			if res != "" && res != "系统代理已取消" {
				return nil, errors.New(res)
			}
			app.CancelIEProxy()
			emitMCPMain("systemproxy", "cancel")
			return map[string]any{"ok": true}, nil
		},
		"ui_theme_get": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeUiThemeGet()
		},
		"ui_theme_set": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeUiThemeSet(argsMap(args))
		},
	})
}

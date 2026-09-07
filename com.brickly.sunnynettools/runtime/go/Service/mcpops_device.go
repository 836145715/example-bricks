package Service

import "runtime"

func init() {
	registerMCPOps("device", map[string]mcpOpHandler{
		"device_status": func(app *AppMain, args map[string]any) (any, error) {
			return map[string]any{
				"isWindows":    runtime.GOOS == "windows",
				"deviceLoaded": app.IsLoadDevice(),
			}, nil
		},
		"device_load": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			mode := argInt(a, "mode", 0)
			ok := app.LoadDevice(mode)
			modeName := "Proxifier"
			switch mode {
			case 1:
				modeName = "NFAPI"
			case 2:
				modeName = "Tun"
			}
			emitMCPDevice("device_loaded", map[string]any{"loaded": ok, "mode": modeName})
			return map[string]any{"ok": ok}, nil
		},
		"device_process_add_name": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			name := argString(a, "name")
			app.ProcessAddName(name)
			emitMCPDevice("add_name", map[string]any{"name": name})
			return map[string]any{"ok": true}, nil
		},
		"device_process_del_name": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			name := argString(a, "name")
			app.ProcessDelName(name)
			emitMCPDevice("del_name", map[string]any{"name": name})
			return map[string]any{"ok": true}, nil
		},
		"device_process_add_pid": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			pid := argInt(a, "pid", 0)
			app.ProcessAddPid(pid)
			emitMCPDevice("add_pid", map[string]any{"pid": pid})
			return map[string]any{"ok": true}, nil
		},
		"device_process_del_pid": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			pid := argInt(a, "pid", 0)
			app.ProcessDelPid(pid)
			emitMCPDevice("del_pid", map[string]any{"pid": pid})
			return map[string]any{"ok": true}, nil
		},
		"device_process_cancel_all": func(app *AppMain, args map[string]any) (any, error) {
			app.ProcessAny(false, false)
			emitMCPDevice("clear_names", map[string]any{})
			emitMCPDevice("clear_pids", map[string]any{})
			emitMCPDevice("process_any", map[string]any{"open": false})
			return map[string]any{"ok": true}, nil
		},
	})
}

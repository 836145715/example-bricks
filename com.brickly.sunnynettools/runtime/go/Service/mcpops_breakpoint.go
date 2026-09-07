package Service

func init() {
	registerMCPOps("breakpoint", map[string]mcpOpHandler{
		"break_continue": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeBreakContinue(app, argsMap(args), false), nil
		},
		"break_continue_all": func(app *AppMain, args map[string]any) (any, error) {
			app.FreeAllRequest()
			emitMCPMainJSON("breakreleaseall", map[string]any{})
			return map[string]any{"ok": true}, nil
		},
		"break_skip_to_response": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeBreakContinue(app, argsMap(args), true), nil
		},
		"break_sync_request": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeBreakSyncRequest(app, argsMap(args))
		},
		"break_sync_response": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeBreakSyncResponse(app, argsMap(args))
		},
		"http_replay": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTPReplay(app, argsMap(args))
		},
	})
}

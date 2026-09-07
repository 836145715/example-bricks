package Service

func init() {
	registerMCPOps("content", map[string]mcpOpHandler{
		"stream_count": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeStreamCount(argsMap(args))
		},
		"stream_slice": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeStreamSlice(argsMap(args))
		},
		"http_get_part": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTPGetPartMulti(app, argsMap(args))
		},
		"stream_get_part": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeStreamGetPartMulti(app, argsMap(args), "auto")
		},
		"stream_get_hex": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeStreamGetPartMulti(app, argsMap(args), "hex")
		},
		"stream_send": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeStreamSend(app, argsMap(args))
		},
		"pb_to_json": func(app *AppMain, args map[string]any) (any, error) {
			return bridgePbToJSON(app, argsMap(args))
		},
	})
}

package Service

func init() {
	registerMCPOps("session", map[string]mcpOpHandler{
		"row_theology": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeRowTheology(argsMap(args)), nil
		},
		"session_get_json": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeSessionGetJSON(argsMap(args))
		},
		"session_pack_export": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeSessionPackExport(app, argsMap(args))
		},
		"records_import": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeRecordsImport(app, argsMap(args))
		},
		"records_export": func(app MCPCore, args map[string]any) (any, error) {
			return bridgeRecordsExport(app, argsMap(args))
		},
	})
}

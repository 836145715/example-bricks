package Service

import "errors"

func init() {
	registerMCPOps("session", map[string]mcpOpHandler{
		"row_theology": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRowTheology(argsMap(args)), nil
		},
		"session_get_json": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeSessionGetJSON(argsMap(args))
		},
		"session_pack_export": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeSessionPackExport(app, argsMap(args))
		},
		"records_import": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRecordsImport(app, argsMap(args))
		},
		"records_export": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRecordsExport(app, argsMap(args))
		},
		"generate_builtin_code": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			th, err := argTheologyOne(a)
			if err != nil {
				return nil, err
			}
			lang := argString(a, "language")
			mod := argString(a, "module")
			if lang == "" || mod == "" {
				return nil, errors.New("language 与 module 必填")
			}
			text := app.AppGenerateCode(th, lang, mod)
			return map[string]any{"text": text}, nil
		},
	})
}

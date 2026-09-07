package Service

func init() {
	registerMCPOps("traffic", map[string]mcpOpHandler{
		"main_count": func(app *AppMain, args map[string]any) (any, error) {
			return map[string]any{"total": bridgeMainCount()}, nil
		},
		"main_slice": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainSlice(argsMap(args)), nil
		},
		"main_cells": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainCells(argsMap(args)), nil
		},
		"main_search": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainSearch(app, argsMap(args))
		},
		"main_row_break_get": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainRowBreakGet(argsMap(args))
		},
		"main_row_note_get": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainRowNoteGet(argsMap(args)), nil
		},
		"main_row_note_set": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainRowNoteSet(argsMap(args))
		},
		"main_apply_row_mark": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainApplyRowMark(argsMap(args))
		},
		"main_clear": func(app *AppMain, args map[string]any) (any, error) {
			app.ClearAllSession()
			emitMCPMain("home", "clear")
			return map[string]any{"ok": true}, nil
		},
		"main_delete": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			ids, err := argTheologyList(a)
			if err != nil {
				ids2, e2 := argIntIDs(a)
				if e2 != nil {
					return nil, err
				}
				app.AppDeleteSession(ids2)
				emitMCPDelReq(ids2)
				return map[string]any{"ok": true, "count": len(ids2)}, nil
			}
			app.AppDeleteSession(ids)
			emitMCPDelReq(ids)
			return map[string]any{"ok": true, "count": len(ids)}, nil
		},
		"main_delete_except": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMainDeleteExcept(app, argsMap(args))
		},
	})
}

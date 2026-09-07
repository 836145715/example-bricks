package Service

func init() {
	registerMCPOps("rules", map[string]mcpOpHandler{
		"config_get_replace": func(app *AppMain, args map[string]any) (any, error) {
			return replaceRulesSnapshot(app, false, false), nil
		},
		"config_set_replace": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			rules, err := parseReplaceRulesJSON(argString(a, "rulesJSON"))
			if err != nil {
				return nil, err
			}
			applyReplaceRulesToConfig(app, rules)
			emitMCPRulesPageReload()
			return map[string]any{"ok": true, "total": len(rules)}, nil
		},
		"config_get_rewrite": func(app *AppMain, args map[string]any) (any, error) {
			return replaceRulesSnapshot(app, false, true), nil
		},
		"config_set_rewrite": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			rules, err := parseReplaceRulesJSON(argString(a, "rulesJSON"))
			if err != nil {
				return nil, err
			}
			if err := validateIncomingReplaceRules(rules, false); err != nil {
				return nil, err
			}
			upsertReplaceRulesSubset(app, rules, false, argBool(a, "replaceAll", false))
			emitMCPRulesPageReload()
			return map[string]any{"ok": true, "total": len(rules)}, nil
		},
		"config_get_intercept": func(app *AppMain, args map[string]any) (any, error) {
			return replaceRulesSnapshot(app, true, false), nil
		},
		"config_set_intercept": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			rules, err := parseReplaceRulesJSON(argString(a, "rulesJSON"))
			if err != nil {
				return nil, err
			}
			if err := validateIncomingReplaceRules(rules, true); err != nil {
				return nil, err
			}
			upsertReplaceRulesSubset(app, rules, true, argBool(a, "replaceAll", false))
			emitMCPRulesPageReload()
			return map[string]any{"ok": true, "total": len(rules)}, nil
		},
		"config_rule_set_state": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeConfigRuleSetState(app, argsMap(args))
		},
		"config_get_block": func(app *AppMain, args map[string]any) (any, error) {
			return map[string]any{"rules": []any{}, "total": 0}, nil
		},
		"config_set_block": func(app *AppMain, args map[string]any) (any, error) {
			emitMCPConfigReload("block")
			return map[string]any{"ok": true}, nil
		},
		"config_get_host": func(app *AppMain, args map[string]any) (any, error) {
			return hostRulesSnapshot(app), nil
		},
		"config_set_host": func(app *AppMain, args map[string]any) (any, error) {
			a := argsMap(args)
			rules, err := parseHostRulesJSON(argString(a, "rulesJSON"))
			if err != nil {
				return nil, err
			}
			if err := applyHostRulesFull(app, rules); err != nil {
				return nil, err
			}
			emitMCPConfigReload("host")
			return map[string]any{"ok": true, "total": len(rules)}, nil
		},
		"config_host_add": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHostAdd(app, argsMap(args))
		},
		"config_host_delete": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHostDelete(app, argsMap(args))
		},
		"config_host_update": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHostUpdate(app, argsMap(args))
		},
	})
}

package Service

func init() {
	registerMCPOps("config", map[string]mcpOpHandler{
		"config_get_proxy_dns": func(app *AppMain, args map[string]any) (any, error) {
			return proxyDnsSnapshot(app), nil
		},
		"config_set_proxy_dns": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyDnsSet(app, argsMap(args))
		},
		"config_get_proxy_way": func(app *AppMain, args map[string]any) (any, error) {
			return proxyWaySnapshot(app), nil
		},
		"config_proxy_way_add": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyWayAdd(app, argsMap(args))
		},
		"config_proxy_way_update": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyWayUpdate(app, argsMap(args))
		},
		"config_proxy_way_update_note": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyWayUpdateNote(app, argsMap(args))
		},
		"config_proxy_way_delete": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyWayDelete(app, argsMap(args))
		},
		"config_proxy_way_set_state": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyWaySetState(app, argsMap(args))
		},
		"config_get_proxy_roles": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyRolesGet(app)
		},
		"config_set_proxy_roles": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeProxyRolesSet(app, argsMap(args))
		},
		"config_get_must_tcp": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMustTcpGet(app)
		},
		"config_set_must_tcp": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeMustTcpSet(app, argsMap(args))
		},
		"config_get_engine_toggles": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeEngineTogglesGet(app)
		},
		"config_get_disable_tcp": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeDisableTCPGet(app)
		},
		"config_get_disable_udp": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeDisableUDPGet(app)
		},
		"config_get_disable_cache": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeDisableCacheGet(app)
		},
		"config_set_disable_tcp": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeDisableTCPSet(app, argsMap(args))
		},
		"config_set_disable_udp": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeDisableUDPSet(app, argsMap(args))
		},
		"config_set_disable_cache": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeDisableCacheSet(app, argsMap(args))
		},
		"config_get_limit_request_size": func(app *AppMain, args map[string]any) (any, error) {
			_, _, _, _, limit := app.GetBaseSettingsValue()
			return map[string]any{"limitRequestSize": limit}, nil
		},
		"config_set_limit_request_size": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeLimitRequestSizeSet(app, argsMap(args))
		},
		"config_get_https_protocol": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTPSProtocolGet(app)
		},
		"config_set_https_protocol": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTPSProtocolSet(app, argsMap(args))
		},
		"config_get_random_ja3": func(app *AppMain, args map[string]any) (any, error) {
			return map[string]any{"randomJa3": app.GetRandomJa3()}, nil
		},
		"config_set_random_ja3": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRandomJa3Set(app, argsMap(args))
		},
		"config_get_http2_fingerprint": func(app *AppMain, args map[string]any) (any, error) {
			return map[string]any{"http2Fingerprint": app.GetHTTPSProto()}, nil
		},
		"config_set_http2_fingerprint": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTP2FingerprintSet(app, argsMap(args))
		},
		"config_apply_http2_template": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTP2TemplateApply(app, argsMap(args))
		},
		"config_list_http2_templates": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTP2TemplateList()
		},
		"config_get_http2_template": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeHTTP2TemplateGet(argsMap(args))
		},
		"request_cert_list": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRequestCertList(app)
		},
		"request_cert_add": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRequestCertAdd(app, argsMap(args))
		},
		"request_cert_delete": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRequestCertDelete(app, argsMap(args))
		},
		"request_cert_update": func(app *AppMain, args map[string]any) (any, error) {
			return bridgeRequestCertUpdate(app, argsMap(args))
		},
	})
}

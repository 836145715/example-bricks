package main

import (
	"encoding/json"

	"changeme/Service/Config"
	"changeme/Service/mcp"
	brickly "github.com/836145715/brickly-sdk-go"
)

func registerUICommands(on func(id string, fn func(input json.RawMessage) (any, error))) {
	on("is-dark", func(json.RawMessage) (any, error) {
		return Server.IsDark(), nil
	})
	on("set-is-dark", func(input json.RawMessage) (any, error) {
		var req struct {
			IsDark bool `json:"isDark"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetIsDark(req.IsDark)
		return map[string]any{"ok": true}, nil
	})
	on("theme", func(input json.RawMessage) (any, error) {
		var req struct {
			IsDark bool   `json:"isDark"`
			Type   string `json:"type"`
			Theme  string `json:"theme"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.Theme(req.IsDark, req.Type, req.Theme), nil
	})
	on("app-get-theme", func(input json.RawMessage) (any, error) {
		var req struct {
			IsDark bool `json:"isDark"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.AppGetTheme(req.IsDark)
		return map[string]any{"ok": true}, nil
	})
	on("get-ag-grid-light-theme", func(json.RawMessage) (any, error) {
		return Server.GetAgGridLightTheme(), nil
	})
	on("get-ag-grid-dark-theme", func(json.RawMessage) (any, error) {
		return Server.GetAgGridDarkTheme(), nil
	})
	on("get-list-color", func(input json.RawMessage) (any, error) {
		var req struct {
			IsDark bool `json:"isDark"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetListColor(req.IsDark), nil
	})
	on("set-list-color", func(input json.RawMessage) (any, error) {
		var req struct {
			IsDark  bool   `json:"isDark"`
			ColorID string `json:"colorId"`
			Color   string `json:"color"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetListColor(req.IsDark, req.ColorID, req.Color)
		return map[string]any{"ok": true}, nil
	})
	on("default-color", func(input json.RawMessage) (any, error) {
		var req struct {
			IsDark bool `json:"isDark"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.DefaultColor(req.IsDark)
		return map[string]any{"ok": true}, nil
	})
	on("get-home-text-mark", func(json.RawMessage) (any, error) {
		return Server.GetHomeTextMark(), nil
	})
	on("set-home-text-mark", func(input json.RawMessage) (any, error) {
		var req struct {
			TextMark string `json:"textMark"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetHomeTextMark(req.TextMark)
		return map[string]any{"ok": true}, nil
	})
	on("get-keys", func(json.RawMessage) (any, error) {
		return Server.GetKeys(), nil
	})
	on("set-keys", func(input json.RawMessage) (any, error) {
		var req struct {
			Obj string `json:"obj"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetKeys(req.Obj)
		return map[string]any{"ok": true}, nil
	})
	on("call-keys", func(input json.RawMessage) (any, error) {
		var req struct {
			ID string `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.CallKeys(req.ID)
		return map[string]any{"ok": true}, nil
	})
	on("set-is-edit-key-down", func(input json.RawMessage) (any, error) {
		var req struct {
			Value bool `json:"value"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetIsEditKeyDown(req.Value)
		return map[string]any{"ok": true}, nil
	})
	on("get-column-state", func(json.RawMessage) (any, error) {
		return Server.GetColumnState(), nil
	})
	on("set-column-state", func(input json.RawMessage) (any, error) {
		var req struct {
			ColumnState string `json:"columnState"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetColumnState(req.ColumnState)
		return map[string]any{"ok": true}, nil
	})
	on("get-base-settings-value", func(json.RawMessage) (any, error) {
		a, b, c, d, e := Server.GetBaseSettingsValue()
		return []any{a, b, c, d, e}, nil
	})
	on("set-disable-tcp", func(input json.RawMessage) (any, error) {
		var req struct {
			Disable bool `json:"disable"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetDisableTCP(req.Disable)
		return map[string]any{"ok": true}, nil
	})
	on("set-disable-udp", func(input json.RawMessage) (any, error) {
		var req struct {
			Disable bool `json:"disable"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetDisableUDP(req.Disable)
		return map[string]any{"ok": true}, nil
	})
	on("set-disable-cache", func(input json.RawMessage) (any, error) {
		var req struct {
			Disable bool `json:"disable"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetDisableCache(req.Disable)
		return map[string]any{"ok": true}, nil
	})
	on("set-limit-request-size", func(input json.RawMessage) (any, error) {
		var req struct {
			Size int `json:"size"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetLimitRequestSize(req.Size)
		return map[string]any{"ok": true}, nil
	})
	on("set-auth-mode", func(input json.RawMessage) (any, error) {
		var req struct {
			Open bool `json:"open"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetAuthMode(req.Open)
		return map[string]any{"ok": true}, nil
	})
	on("auth-mode-create", func(json.RawMessage) (any, error) {
		return Server.AuthModeCreate(), nil
	})
	on("auth-mode-list", func(json.RawMessage) (any, error) {
		return Server.AuthModeList(), nil
	})
	on("auth-mode-set", func(input json.RawMessage) (any, error) {
		var req struct {
			ID   int    `json:"id"`
			User string `json:"user"`
			Pass string `json:"pass"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.AuthModeSet(req.ID, req.User, req.Pass)
		return map[string]any{"ok": true}, nil
	})
	on("auth-mode-remove", func(input json.RawMessage) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.AuthModeRemove(req.ID)
		return map[string]any{"ok": true}, nil
	})
	on("reset-all-config", func(json.RawMessage) (any, error) {
		Server.ResetALLConfig()
		return map[string]any{"ok": true}, nil
	})
	on("get-tour", func(input json.RawMessage) (any, error) {
		var req struct {
			NewTour bool `json:"newTour"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetTour(req.NewTour), nil
	})
	on("app-get-editor-font-size", func(json.RawMessage) (any, error) {
		return Server.AppGetEditorFontSize(), nil
	})
	on("app-set-editor-font-size", func(input json.RawMessage) (any, error) {
		var req struct {
			Size int `json:"size"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.AppSetEditorFontSize(req.Size)
		return map[string]any{"ok": true}, nil
	})
	on("get-ipv4-interface-adders", func(json.RawMessage) (any, error) {
		return Server.GetIPV4InterfaceAdders(), nil
	})
	on("get-interface-out-router-adders", func(json.RawMessage) (any, error) {
		return Server.GetInterfaceOutRouterAdders(), nil
	})
	on("set-interface-out-router-adders", func(input json.RawMessage) (any, error) {
		var req struct {
			IP string `json:"ip"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetInterfaceOutRouterAdders(req.IP)
		return map[string]any{"ok": true}, nil
	})
	on("get-send-is-http1", func(json.RawMessage) (any, error) {
		return Server.GetSendIsHTTP1(), nil
	})
	on("set-send-is-http1", func(input json.RawMessage) (any, error) {
		var req struct {
			Value bool `json:"value"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetSendIsHTTP1(req.Value)
		return map[string]any{"ok": true}, nil
	})
	on("get-https-proto", func(json.RawMessage) (any, error) {
		return Server.GetHTTPSProto(), nil
	})
	on("set-https-proto", func(input json.RawMessage) (any, error) {
		var req struct {
			Proto string `json:"proto"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetHTTPSProto(req.Proto)
		return map[string]any{"ok": true}, nil
	})
	on("apply-https-protocol", func(input json.RawMessage) (any, error) {
		var req struct {
			SendIsHTTP1 *bool  `json:"sendIsHTTP1"`
			ProtoJSON   string `json:"protoJSON"`
			RandomJa3   *bool  `json:"randomJa3"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ApplyHTTPSProtocol(req.SendIsHTTP1, req.ProtoJSON, req.RandomJa3)
	})
	on("get-random-ja3", func(json.RawMessage) (any, error) {
		return Server.GetRandomJa3(), nil
	})
	on("set-random-ja3", func(input json.RawMessage) (any, error) {
		var req struct {
			Open bool `json:"open"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetRandomJa3(req.Open)
		return map[string]any{"ok": true}, nil
	})
	on("get-must-tcp-roles", func(json.RawMessage) (any, error) {
		return Server.GetMustTcpRoles(), nil
	})
	on("get-must-tcp-type", func(json.RawMessage) (any, error) {
		return Server.GetMustTcpType(), nil
	})
	on("set-must-tcp-roles", func(input json.RawMessage) (any, error) {
		var req struct {
			Type  int    `json:"type"`
			Roles string `json:"roles"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetMustTcpRoles(req.Type, req.Roles)
		return map[string]any{"ok": true}, nil
	})
	on("get-proxy-dns", func(json.RawMessage) (any, error) {
		return Server.GetProxyDns(), nil
	})
	on("set-proxy-dns", func(input json.RawMessage) (any, error) {
		var req struct {
			DNS string `json:"dns"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetProxyDns(req.DNS)
		return map[string]any{"ok": true}, nil
	})
	on("get-proxy-roles", func(json.RawMessage) (any, error) {
		return Server.GetProxyRoles(), nil
	})
	on("set-proxy-roles", func(input json.RawMessage) (any, error) {
		var req struct {
			Roles string `json:"roles"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.SetProxyRoles(req.Roles)
		return map[string]any{"ok": true}, nil
	})
	on("create-proxy-way", func(json.RawMessage) (any, error) {
		return Server.CreateProxyWay(), nil
	})
	on("proxy-way-list", func(json.RawMessage) (any, error) {
		return Server.ProxyWayList(), nil
	})
	on("proxy-way-remove", func(input json.RawMessage) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ProxyWayRemove(req.ID)
		return map[string]any{"ok": true}, nil
	})
	on("proxy-way-update", func(input json.RawMessage) (any, error) {
		var req struct {
			ID    int    `json:"id"`
			URL   string `json:"url"`
			State string `json:"state"`
			Note  string `json:"note"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ProxyWayUpdate(req.ID, req.URL, req.State, req.Note), nil
	})
	on("reapply-engine-from-config", func(json.RawMessage) (any, error) {
		return Server.ReapplyEngineFromConfig(), nil
	})
	on("create-replace-body", func(json.RawMessage) (any, error) {
		return Server.CreateReplaceBody(), nil
	})
	on("replace-body-list", func(json.RawMessage) (any, error) {
		return Server.ReplaceBodyList(), nil
	})
	on("replace-body-remove", func(input json.RawMessage) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ReplaceBodyRemove(req.ID)
		return map[string]any{"ok": true}, nil
	})
	on("replace-body-update", func(input json.RawMessage) (any, error) {
		var req struct {
			ID     int    `json:"id"`
			Type   string `json:"type"`
			Source string `json:"source"`
			Lod    string `json:"lod"`
			New    string `json:"new"`
			Note   string `json:"note"`
			State  string `json:"state"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ReplaceBodyUpdate(req.ID, req.Type, req.Source, req.Lod, req.New, req.Note, req.State), nil
	})
	on("create-replace-host", func(json.RawMessage) (any, error) {
		return Server.CreateReplaceHost(), nil
	})
	on("replace-host-list", func(json.RawMessage) (any, error) {
		return Server.ReplaceHostList(), nil
	})
	on("replace-host-remove", func(input json.RawMessage) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.ReplaceHostRemove(req.ID)
		return map[string]any{"ok": true}, nil
	})
	on("replace-host-update", func(input json.RawMessage) (any, error) {
		var req struct {
			ID   int    `json:"id"`
			Lod  string `json:"lod"`
			New  string `json:"new"`
			Note string `json:"note"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ReplaceHostUpdate(req.ID, req.Lod, req.New, req.Note), nil
	})
	on("create-authentication", func(json.RawMessage) (any, error) {
		return Server.CreateAuthentication(), nil
	})
	on("authentication-list", func(json.RawMessage) (any, error) {
		return Server.AuthenticationList(), nil
	})
	on("authentication-remove", func(input json.RawMessage) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.AuthenticationRemove(req.ID)
		return map[string]any{"ok": true}, nil
	})
	on("authentication-update", func(input json.RawMessage) (any, error) {
		var req struct {
			ID   int    `json:"id"`
			User string `json:"user"`
			Pass string `json:"pass"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.AuthenticationUpdate(req.ID, req.User, req.Pass), nil
	})
	on("create-request-cert", func(json.RawMessage) (any, error) {
		return Server.CreateRequestCert(), nil
	})
	on("request-list", func(json.RawMessage) (any, error) {
		return Server.RequestList(), nil
	})
	on("request-cert-remove", func(input json.RawMessage) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.RequestCertRemove(req.ID)
		return map[string]any{"ok": true}, nil
	})
	on("request-cert-set-file", func(input json.RawMessage) (any, error) {
		var req struct {
			ID     int    `json:"id"`
			Role   string `json:"role"`
			DoMain string `json:"doMain"`
			File   string `json:"file"`
			Pass   string `json:"pass"`
			Note   string `json:"note"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.RequestCertSetFile(req.ID, req.Role, req.DoMain, req.File, req.Pass, req.Note), nil
	})
	on("request-cert-get-common-name", func(input json.RawMessage) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.RequestCertGetCommonName(req.ID), nil
	})
	on("custom-tools-list", func(json.RawMessage) (any, error) {
		return Server.CustomToolsList(), nil
	})
	on("custom-tools-add", func(input json.RawMessage) (any, error) {
		var req struct {
			FilePath string `json:"filePath"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.CustomToolsAdd(req.FilePath), nil
	})
	on("custom-tools-del", func(input json.RawMessage) (any, error) {
		var req struct {
			ID string `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.CustomToolsDel(req.ID), nil
	})
	on("exec-custom-tools", func(input json.RawMessage) (any, error) {
		var req struct {
			ID string `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ExecCustomTools(req.ID), nil
	})
	on("save-custom-tools", func(input json.RawMessage) (any, error) {
		var req struct {
			ObjInfo Config.ToolsInfo `json:"objInfo"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.SaveCustomTools(req.ObjInfo), nil
	})
	on("clipboard-read-all", func(json.RawMessage) (any, error) {
		return Server.ClipboardReadAll(), nil
	})
	on("clipboard-write-all", func(input json.RawMessage) (any, error) {
		var req struct {
			Value string `json:"value"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ClipboardWriteAll(req.Value), nil
	})
	on("go-get-hex", func(input json.RawMessage) (any, error) {
		var req struct {
			Data []byte `json:"data"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GoGetHex(req.Data), nil
	})
	on("protobuf-to-json", func(input json.RawMessage) (any, error) {
		var req struct {
			Data []byte `json:"data"`
			Skip int    `json:"skip"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ProtobufToJson(req.Data, req.Skip), nil
	})
	on("url-query-escape", func(input json.RawMessage) (any, error) {
		var req struct {
			Value string `json:"value"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.URLQueryEscape(req.Value), nil
	})
	on("url-query-unescape", func(input json.RawMessage) (any, error) {
		var req struct {
			Value string `json:"value"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.URLQueryUnescape(req.Value), nil
	})
	on("free-all-request", func(json.RawMessage) (any, error) {
		Server.FreeAllRequest()
		return map[string]any{"ok": true}, nil
	})
	on("list-search", func(input json.RawMessage) (any, error) {
		var req struct {
			FilterJSON string `json:"filterJson"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ListSearch(req.FilterJSON), nil
	})
	on("stream-search", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology   int    `json:"theology"`
			FilterJSON string `json:"filterJson"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.StreamSearch(req.Theology, req.FilterJSON), nil
	})
	on("get-socket-filter", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int `json:"theology"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.GetSocketFilter(req.Theology), nil
	})
	on("del-session-message-id-array", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology       int   `json:"theology"`
			MessageIdArray []int `json:"messageIdArray"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.DelSessionMessageIdArray(req.Theology, req.MessageIdArray), nil
	})
	on("clear-all-session-message-id-array", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology int `json:"theology"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.ClearAllSessionMessageIdArray(req.Theology), nil
	})
	on("copy-session-message-id-array", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology       int    `json:"theology"`
			CopyType       string `json:"copyType"`
			MessageIdArray []int  `json:"messageIdArray"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.CopySessionMessageIdArray(req.Theology, req.CopyType, req.MessageIdArray), nil
	})
	on("app-save-request-img", func(input json.RawMessage) (any, error) {
		var req struct {
			Theology  int    `json:"theology"`
			ImgType   string `json:"imgType"`
			IsRequest bool   `json:"isRequest"`
			Path      string `json:"path"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		return Server.AppSaveRequestImg(req.Theology, req.ImgType, req.IsRequest, req.Path), nil
	})
	on("open-sunny-file", func(input json.RawMessage) (any, error) {
		var req struct {
			Prompt string `json:"prompt"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		p, err := Server.OpenSunnyFile(req.Prompt)
		if err != nil {
			return "", nil
		}
		return p, nil
	})
	on("save-sunny-file", func(input json.RawMessage) (any, error) {
		var req struct {
			Prompt string `json:"prompt"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		p, err := Server.SaveSunnyFile(req.Prompt)
		if err != nil {
			return "", nil
		}
		return p, nil
	})
	on("script-log-init", func(json.RawMessage) (any, error) {
		Server.ScriptLogInit()
		return map[string]any{"ok": true}, nil
	})
	on("print-script-log", func(input json.RawMessage) (any, error) {
		var req struct {
			Info []any `json:"info"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.PrintScriptLog(0, req.Info...)
		return map[string]any{"ok": true}, nil
	})
	on("save-script-code", func(input json.RawMessage) (any, error) {
		var req struct {
			Code json.RawMessage `json:"code"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		var asString string
		var asBytes []byte
		if json.Unmarshal(req.Code, &asString) == nil {
			asBytes = []byte(asString)
		} else if json.Unmarshal(req.Code, &asBytes) != nil {
			asBytes = req.Code
		}
		Server.SaveScriptCode(0, asBytes)
		return map[string]any{"ok": true}, nil
	})
	on("mcp-func-res", func(input json.RawMessage) (any, error) {
		var req struct {
			Page string `json:"page"`
			Tag  string `json:"tag"`
			Msg  string `json:"msg"`
			Res  string `json:"res"`
			ID   uint32 `json:"id"`
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		Server.McpFuncRes(mcp.McpMsg{Page: req.Page, Tag: req.Tag, Msg: req.Msg, Res: req.Res, Id: req.ID})
		return map[string]any{"ok": true}, nil
	})
	on("is-load-device", func(json.RawMessage) (any, error) {
		return Server.IsLoadDevice(), nil
	})
}

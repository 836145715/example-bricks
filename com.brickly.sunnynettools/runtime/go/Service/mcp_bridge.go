package Service

import (
	"changeme/Service/Config"
	"changeme/Service/Session"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"

	"changeme/Service/mcp"
	"github.com/qtgolang/SunnyNet/src/http"
	"github.com/qtgolang/SunnyNet/src/public"
)

var mcpApp *AppMain

// SetMCPServer 绑定主程序实例（CreateMainWindow 时调用）。
func SetMCPServer(app *AppMain) {
	mcpApp = app
}

// MCPBridgeInvoke MCP 桥 op 入口（供 mcpbridge.BackendInvoke 使用）。
func MCPBridgeInvoke(op string, args map[string]any) (any, error) {
	if mcpApp == nil {
		return nil, errors.New("mcp: 主程序未初始化")
	}
	return mcpBridgeInvoke(mcpApp, op, args)
}

func mcpBridgeInvoke(app *AppMain, op string, args map[string]any) (any, error) {
	// 按能力分级分发：op 处理器在各 mcpops_<domain>.go 中注册，扁平 switch 已移除。
	return dispatchMCPOp(app, op, args)
}


func argsMap(args map[string]any) map[string]any {
	if args == nil {
		return map[string]any{}
	}
	return args
}

func argString(m map[string]any, k string) string {
	v, ok := m[k]
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}

func argStringSlice(m map[string]any, k string) []string {
	v, ok := m[k]
	if !ok {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

func argInt(m map[string]any, k string, def int) int {
	v, ok := m[k]
	if !ok {
		return def
	}
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case int64:
		return int(t)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(t))
		return n
	default:
		return def
	}
}

func argBool(m map[string]any, k string, def bool) bool {
	v, ok := m[k]
	if !ok {
		return def
	}
	b, ok := v.(bool)
	if ok {
		return b
	}
	if f, ok := v.(float64); ok {
		return f != 0
	}
	return def
}

func argIntSlice(m map[string]any, k string) []int {
	v, ok := m[k]
	if !ok {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]int, 0, len(arr))
	for _, x := range arr {
		switch t := x.(type) {
		case float64:
			out = append(out, int(t))
		case int:
			out = append(out, t)
		case string:
			n, _ := strconv.Atoi(strings.TrimSpace(t))
			if n > 0 {
				out = append(out, n)
			}
		}
	}
	return out
}

func argTheologyList(m map[string]any) ([]int, error) {
	var out []int
	seen := map[int]struct{}{}
	add := func(th int) {
		if th == 0 {
			return
		}
		if _, ok := seen[th]; ok {
			return
		}
		seen[th] = struct{}{}
		out = append(out, th)
	}
	listIndexes := argIntSlice(m, "listIndexes")
	if idx := argInt(m, "listIndex", 0); idx > 0 {
		listIndexes = append(listIndexes, idx)
	}
	if len(listIndexes) > 0 {
		m, err := theologyAtListIndex(listIndexes...)
		if err != nil {
			return nil, err
		}
		for _, idx := range listIndexes {
			th := m[strconv.Itoa(idx)]
			if th == 0 {
				return nil, fmt.Errorf("listIndex %d 不存在", idx)
			}
			add(th)
		}
	}
	if th := argInt(m, "theology", 0); th != 0 {
		add(th)
	}
	for _, th := range argIntSlice(m, "theologies") {
		add(th)
	}
	for _, key := range []string{"rowId", "rowIds", "ids"} {
		v, ok := m[key]
		if !ok {
			continue
		}
		switch t := v.(type) {
		case string:
			add(rowIDToTheology(t))
		case []any:
			for _, x := range t {
				if s, ok := x.(string); ok {
					add(rowIDToTheology(s))
				}
			}
		}
	}
	if len(out) == 0 {
		return nil, errors.New("listIndex、theology、rowId 或 ids 至少填一项")
	}
	return out, nil
}

func argTheologyOne(m map[string]any) (int, error) {
	list, err := argTheologyList(m)
	if err != nil {
		return 0, err
	}
	if len(list) != 1 {
		return 0, errors.New("需要恰好一个 theology/rowId")
	}
	return list[0], nil
}

func argIntIDs(m map[string]any) ([]int, error) {
	if ids := argIntSlice(m, "ids"); len(ids) > 0 {
		return ids, nil
	}
	return argTheologyList(m)
}

// rowIDToTheology 将 rowId 解析为 theology。约定：rowId === strconv.Itoa(theology)，非 http-* 等别名。
func rowIDToTheology(rowID string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(rowID))
	return n
}

func bridgeGetStatus(app *AppMain) map[string]any {
	running := app.GetError() == "" && app.GetPort() > 0
	return map[string]any{
		"sunnyRunning":       running,
		"sunnyPort":          app.GetPort(),
		"sunnyLastError":     app.GetError(),
		"systemProxyEnabled": Config.Config.IEProxy,
		"captureVisible":     atomic.LoadUint32(&Config.Config.IsHideHook) == 0,
		"breakMode":          atomic.LoadUint32(&Config.Config.BreakMode),
		"mainCount":          bridgeMainCount(),
	}
}

func bridgeMainCount() int {
	return len(collectMainTheologies())
}

func bridgeBreakContinue(app *AppMain, m map[string]any, skipToResponse bool) any {
	ids, err := argTheologyList(m)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	mode := uint32(0)
	if skipToResponse {
		mode = 2
	}
	released := make([]int, 0, len(ids))
	for _, th := range ids {
		obj := Session.GetHttpSession(th)
		if obj == nil {
			continue
		}
		if skipToResponse {
			obj.NextBreakMode = 2
		}
		obj.Wg.Done()
		released = append(released, th)
	}
	if len(released) > 0 {
		emitMCPMainJSON("breakrelease", map[string]any{"ids": released, "mode": mode})
	}
	if len(ids) == 1 {
		return map[string]any{"ok": true}
	}
	return map[string]any{"ok": true, "count": len(released)}
}

func bridgeMainRowBreakGet(m map[string]any) (any, error) {
	ids, err := argTheologyList(m)
	if err != nil {
		return nil, err
	}
	if len(ids) == 1 {
		return httpSessionBreakStatus(ids[0]), nil
	}
	items := make([]map[string]any, len(ids))
	for i, th := range ids {
		items[i] = httpSessionBreakStatus(th)
	}
	return map[string]any{"items": items}, nil
}

func httpSessionBreakStatus(th int) map[string]any {
	hs := Session.GetHttpSession(th)
	if hs == nil {
		return map[string]any{
			"theology":  th,
			"rowId":     strconv.Itoa(th),
			"found":     false,
			"breakMode": 0,
			"isWaiting": false,
		}
	}
	var (
		waiting   bool
		bm        uint32
		intercept string
		state     int
	)
	hs.ReadLocked(func() {
		waiting = hs.IsWait()
		state = hs.State
		intercept = "非拦截"
		if waiting {
			switch hs.State {
			case public.HttpSendRequest:
				bm = 1
				intercept = "上行"
			case public.HttpResponseOK:
				bm = 2
				intercept = "下行"
			default:
				bm = 1
				intercept = "拦截"
			}
		}
	})
	return map[string]any{
		"theology":       th,
		"rowId":          strconv.Itoa(th),
		"found":          true,
		"breakMode":      bm,
		"isWaiting":      waiting,
		"interceptState": intercept,
		"state":          state,
	}
}

// argBreakContinue 为 true 时改包后同时放行（Wg.Done）；默认 false 仅同步数据与主列表。
func argBreakContinue(m map[string]any) bool {
	if argBool(m, "continue", false) || argBool(m, "release", false) {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(argString(m, "action"))) {
	case "continue", "release", "放行":
		return true
	}
	return false
}

func bridgeBreakSyncRequest(app *AppMain, m map[string]any) (any, error) {
	ids, err := argTheologyList(m)
	if err != nil {
		return nil, err
	}
	url := argString(m, "requestURL")
	headersJSON := argString(m, "headersJSON")
	bodyB64 := argString(m, "bodyB64")
	patch := hasBreakSyncRequestPatch(m)
	cont := argBreakContinue(m)
	if !patch && !cont {
		return nil, errors.New("未提供 requestURL/headersJSON/bodyB64，且未请求放行")
	}
	listUpdated := false
	for _, th := range ids {
		obj := Session.GetHttpSession(th)
		if err := requireBreakUpstream(obj, th); err != nil {
			return nil, err
		}
		if patch {
			if err := rejectUpstreamMethodChange(m, obj.Request.Method); err != nil {
				return nil, err
			}
			req := &Session.HttpSessionRequest{
				Url:    obj.Request.Url,
				Method: obj.Request.Method,
				Header: obj.Request.Header.Clone(),
				Body:   append([]byte(nil), obj.Request.Body...),
			}
			if url != "" {
				req.Url = url
			}
			if headersJSON != "" {
				var hdr http.Header
				if e := json.Unmarshal([]byte(headersJSON), &hdr); e == nil {
					req.Header = hdr
				}
			}
			if bodyB64 != "" {
				bs, e := base64.StdEncoding.DecodeString(bodyB64)
				if e != nil {
					return nil, e
				}
				req.Body = bs
			}
			app.UpdateHttpRequest(th, req)
			listUpdated = true
		}
		if cont {
			obj.Wg.Done()
			emitMCPRowRefresh(th)
		}
	}
	if len(ids) == 1 {
		return map[string]any{"ok": true, "continued": cont, "listUpdated": listUpdated}, nil
	}
	return map[string]any{"ok": true, "count": len(ids), "continued": cont, "listUpdated": listUpdated}, nil
}

func bridgeBreakSyncResponse(app *AppMain, m map[string]any) (any, error) {
	ids, err := argTheologyList(m)
	if err != nil {
		return nil, err
	}
	statusCode := argInt(m, "statusCode", 200)
	headersJSON := argString(m, "headersJSON")
	bodyB64 := argString(m, "bodyB64")
	patch := hasBreakSyncResponsePatch(m)
	cont := argBreakContinue(m)
	if !patch && !cont {
		return nil, errors.New("未提供 statusCode/headersJSON/bodyB64，且未请求放行")
	}
	listUpdated := false
	for _, th := range ids {
		obj := Session.GetHttpSession(th)
		if err := requireBreakDownstream(obj, th); err != nil {
			return nil, err
		}
		if patch {
			code := obj.Response.Code
			state := obj.Response.State
			if _, ok := m["statusCode"]; ok {
				code = strconv.Itoa(statusCode)
				state = http.StatusText(statusCode)
			}
			resp := &Session.HttpSessionResponse{
				Code:   code,
				State:  state,
				Header: obj.Response.Header.Clone(),
				Body:   append([]byte(nil), obj.Response.Body...),
			}
			if headersJSON != "" {
				var hdr http.Header
				if e := json.Unmarshal([]byte(headersJSON), &hdr); e == nil {
					resp.Header = hdr
				}
			}
			if bodyB64 != "" {
				bs, e := base64.StdEncoding.DecodeString(bodyB64)
				if e != nil {
					return nil, e
				}
				resp.Body = bs
			}
			app.UpdateHttpResponse(th, resp)
			listUpdated = true
		}
		if cont {
			obj.Wg.Done()
			emitMCPRowRefresh(th)
		}
	}
	if len(ids) == 1 {
		return map[string]any{"ok": true, "continued": cont, "listUpdated": listUpdated}, nil
	}
	return map[string]any{"ok": true, "count": len(ids), "continued": cont, "listUpdated": listUpdated}, nil
}

func bridgeHTTPReplay(app *AppMain, m map[string]any) (any, error) {
	ids, err := argTheologyList(m)
	if err != nil {
		return nil, err
	}
	intercept := argInt(m, "interceptMode", 0)
	repeat := argInt(m, "repeatCount", 1)
	if repeat <= 0 {
		repeat = 1
	}
	for _, th := range ids {
		ok := app.AppResendRequest(th, repeat, intercept)
		if !ok {
			return nil, fmt.Errorf("重放失败 theology=%d", th)
		}
	}
	if len(ids) == 1 {
		return map[string]any{"ok": true}, nil
	}
	return map[string]any{"ok": true, "count": len(ids)}, nil
}

func bridgeRowTheology(m map[string]any) any {
	ids, err := argTheologyList(m)
	if err != nil {
		if s := argString(m, "rowId"); s != "" {
			th := rowIDToTheology(s)
			return map[string]any{"theology": th, "rowId": strconv.Itoa(th)}
		}
		return map[string]any{"theology": 0, "rowId": "0"}
	}
	if len(ids) == 1 {
		th := ids[0]
		return map[string]any{"theology": th, "rowId": strconv.Itoa(th)}
	}
	items := make([]map[string]any, len(ids))
	for i, th := range ids {
		items[i] = map[string]any{"rowId": strconv.Itoa(th), "theology": th}
	}
	return map[string]any{"items": items}
}

func bridgeMainRowNoteGet(m map[string]any) any {
	ids, err := argTheologyList(m)
	if err != nil {
		return map[string]any{"note": "", "found": false}
	}
	item := func(th int) map[string]any {
		obj := Session.GetAppSession(th)
		if obj == nil {
			return map[string]any{"rowId": strconv.Itoa(th), "note": "", "found": false}
		}
		return map[string]any{"rowId": strconv.Itoa(th), "note": obj.GetNote(), "found": true}
	}
	if len(ids) == 1 {
		return item(ids[0])
	}
	items := make([]map[string]any, len(ids))
	for i, th := range ids {
		items[i] = item(th)
	}
	return map[string]any{"items": items}
}

func bridgeMainRowNoteSet(m map[string]any) (any, error) {
	ids, err := argTheologyList(m)
	if err != nil {
		return nil, err
	}
	note := argString(m, "note")
	for _, th := range ids {
		if Session.GetAppSession(th) == nil {
			return nil, fmt.Errorf("theology %d 不存在", th)
		}
		if mcpApp != nil {
			mcpApp.UpdateNote(th, note)
		}
	}
	if len(ids) > 0 {
		emitMCPMainJSON("rownote", map[string]any{"ids": ids, "note": note})
	}
	if len(ids) == 1 {
		return map[string]any{"ok": true, "rowId": strconv.Itoa(ids[0])}, nil
	}
	rowIds := make([]string, len(ids))
	for i, th := range ids {
		rowIds[i] = strconv.Itoa(th)
	}
	return map[string]any{"ok": true, "rowIds": rowIds, "count": len(ids)}, nil
}

func bridgeSessionGetJSON(m map[string]any) (any, error) {
	ids, err := argTheologyList(m)
	if err != nil {
		return nil, err
	}
	if len(ids) == 1 {
		return sessionJSONDetail(ids[0])
	}
	items := make([]map[string]any, 0, len(ids))
	for _, th := range ids {
		s, e := sessionJSONDetail(th)
		if e != nil {
			return nil, e
		}
		items = append(items, map[string]any{"theology": th, "session": s})
	}
	return map[string]any{"items": items}, nil
}

func bridgePbToJSON(app *AppMain, m map[string]any) (any, error) {
	dataB64 := argString(m, "dataB64")
	if dataB64 == "" {
		return nil, errors.New("dataB64 必填")
	}
	bs, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return nil, err
	}
	skip := argInt(m, "skipFirstBytes", 0)
	if skip > len(bs) {
		skip = len(bs)
	}
	text := app.ProtobufToJson(bs, skip)
	if strings.TrimSpace(text) == "" {
		text = mcp.PbConvertViaWebview(base64.StdEncoding.EncodeToString(bs[skip:]))
	}
	return map[string]any{
		"text":                text,
		"inputBytesAfterSkip": len(bs) - skip,
		"charCount":           len(text),
	}, nil
}

func bridgeMainSlice(m map[string]any) any {
	offset := argInt(m, "offset", 0)
	limit := argInt(m, "limit", 50)
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	all := collectMainTheologies()
	total := len(all)
	end := offset + limit
	if end > total {
		end = total
	}
	page := all[offset:end]
	rows := make([]map[string]any, len(page))
	for i, th := range page {
		listIndex := offset + i + 1
		rows[i] = map[string]any{
			"listIndex": listIndex,
			"theology":  th,
			"rowId":     strconv.Itoa(th),
			"cells":     sessionCells(th, listIndex),
		}
	}
	return map[string]any{
		"columns": mainSliceColumns(),
		"rows":    rows,
		"total":   total,
		"offset":  offset,
		"limit":   limit,
	}
}

func bridgeMainCells(m map[string]any) any {
	ids, err := argTheologyList(m)
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	if len(ids) == 1 {
		th := ids[0]
		return map[string]any{
			"rowId":     strconv.Itoa(th),
			"theology":  th,
			"listIndex": theologyListIndex(th),
			"cells":     sessionCells(th, theologyListIndex(th)),
		}
	}
	items := make([]map[string]any, len(ids))
	for i, th := range ids {
		items[i] = map[string]any{
			"rowId":     strconv.Itoa(th),
			"theology":  th,
			"listIndex": theologyListIndex(th),
			"cells":     sessionCells(th, theologyListIndex(th)),
		}
	}
	return map[string]any{"items": items}
}

func bridgeMainDeleteExcept(app *AppMain, m map[string]any) (any, error) {
	keep, err := argTheologyList(m)
	if err != nil {
		keep = nil
		for _, id := range argStringSlice(m, "keepIds") {
			if th := rowIDToTheology(id); th > 0 {
				keep = append(keep, th)
			}
		}
		if len(keep) == 0 {
			return nil, errors.New("keepIds 或 theology 至少填一项")
		}
	}
	keepSet := map[int]struct{}{}
	for _, th := range keep {
		keepSet[th] = struct{}{}
	}
	var del []int
	Session.Session.Range(func(key, _ any) bool {
		th, ok := key.(int)
		if !ok {
			return true
		}
		if _, ok := keepSet[th]; !ok {
			del = append(del, th)
		}
		return true
	})
	if len(del) > 0 {
		app.AppDeleteSession(del)
		emitMCPDelReq(del)
	}
	return map[string]any{"ok": true, "deleted": len(del)}, nil
}

func emitMCPDelReq(ids []int) {
	if len(ids) == 0 {
		return
	}
	emitMCPMainJSON("delreq", ids)
}

func bridgeMainApplyRowMark(m map[string]any) (any, error) {
	mark := strings.TrimSpace(argString(m, "mark"))
	if mark == "" {
		return nil, errors.New("mark 必填")
	}
	ids, err := argTheologyList(m)
	if err != nil {
		return nil, err
	}
	emitMCPMainJSON("rowmark", map[string]any{"ids": ids, "mark": mark})
	return map[string]any{"ok": true, "count": len(ids)}, nil
}

func bridgeStreamSend(app *AppMain, m map[string]any) (any, error) {
	th, err := argTheologyOne(m)
	if err != nil {
		return nil, err
	}
	dataB64 := argString(m, "dataB64")
	if dataB64 == "" {
		dataB64 = argString(m, "bodyB64")
	}
	if dataB64 == "" {
		return nil, errors.New("dataB64 必填")
	}
	bs, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return nil, err
	}
	toServer := argBool(m, "toServer", false)
	dir := strings.ToLower(argString(m, "direction"))
	if dir == "server" {
		toServer = true
	} else if dir == "client" {
		toServer = false
	}
	wsType := argInt(m, "wsFrameType", 1)
	sendType := argString(m, "sendType")
	if sendType == "" {
		sendType = "Text"
	}
	msg := app.SessionActiveSend(th, toServer, sendType, wsType, bs)
	if msg != "" {
		return nil, errors.New(msg)
	}
	return map[string]any{"ok": true}, nil
}

func collectMainTheologies() []int {
	var all []int
	Session.Session.Range(func(key, value any) bool {
		th, ok := key.(int)
		if !ok {
			return true
		}
		obj, ok := value.(Session.AppSession)
		if !ok || obj == nil {
			return true
		}
		if obj.ListMatch() || obj.IsWait() {
			all = append(all, th)
		}
		return true
	})
	sort.Ints(all)
	return all
}

func theologyAtListIndex(listIndex ...int) (mcp.ListIndexTheologyMap, error) {
	if len(listIndex) == 0 {
		return nil, errors.New("没有传入 listIndex")
	}
	for _, idx := range listIndex {
		if idx <= 0 {
			return nil, fmt.Errorf("listIndex 须为从 1 开始的正整数，收到 %d", idx)
		}
	}
	if m, err := mcp.ListIndexesToTheologies(listIndex...); err == nil {
		return m, nil
	}
	all := collectMainTheologies()
	out := make(mcp.ListIndexTheologyMap, len(listIndex))
	for _, idx := range listIndex {
		key := strconv.Itoa(idx)
		if idx <= len(all) {
			out[key] = all[idx-1]
		} else {
			out[key] = 0
		}
	}
	return out, nil
}

func theologyListIndex(th int) int {
	all := collectMainTheologies()
	for i, t := range all {
		if t == th {
			return i + 1
		}
	}
	return 0
}

func mainSliceColumns() []map[string]string {
	return []map[string]string{
		{"key": "序号", "title": "序号"},
		{"key": "方式", "title": "方式"},
		{"key": "URL", "title": "URL"},
		{"key": "状态", "title": "状态"},
		{"key": "注释", "title": "注释"},
		{"key": "进程", "title": "进程"},
	}
}

func sessionCells(th int, listIndex int) []string {
	seq := strconv.Itoa(listIndex)
	if listIndex <= 0 {
		seq = strconv.Itoa(th)
	}
	if hs := Session.GetHttpSession(th); hs != nil {
		var cells []string
		hs.ReadLocked(func() {
			state := hs.Response.Code
			if hs.State == public.HttpRequestFail {
				state = "错误"
			}
			if hs.IsWait() {
				switch hs.State {
				case public.HttpSendRequest:
					state = "拦截上行"
				case public.HttpResponseOK:
					state = "拦截下行"
				default:
					state = "拦截"
				}
			}
			cells = []string{seq, hs.GetMethod(), hs.Request.Url, state, hs.GetNote(), hs.Request.ProcessName}
		})
		return cells
	}
	if ts := Session.GetTCPSession(th); ts != nil {
		st := "已连接"
		if ts.Disconnect {
			st = "已断开"
		}
		return []string{seq, ts.GetMethod(), ts.RemoteAddress, st, ts.GetNote(), ts.ProcessName}
	}
	if us := Session.GetUDPSession(th); us != nil {
		return []string{seq, us.GetMethod(), us.RemoteAddress, "  -  ", us.GetNote(), us.ProcessName}
	}
	return []string{seq, "", "", "", "", ""}
}

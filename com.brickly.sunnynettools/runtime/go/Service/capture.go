package Service

import (
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"sync"

	"changeme/Service/Config"
	"changeme/Service/Session"
)

// 数据面（Phase 1）：Go 为唯一数据源。
// captureIndex 维护插入序的 Theology 索引；captureSummary 按需派生行摘要；
// captureHub 管理前端 capture-stream interact 会话，只广播轻量增量。

// ---- 有序索引 ----

var (
	captureMu    sync.RWMutex
	captureOrder []int
	capturePos   = make(map[int]int)
	// 过滤视图：ListSearch 结果集（nil = 不过滤）
	captureFilterSet map[int]bool
)

func captureAppend(theology int) {
	captureMu.Lock()
	defer captureMu.Unlock()
	if _, ok := capturePos[theology]; ok {
		return
	}
	captureOrder = append(captureOrder, theology)
	capturePos[theology] = len(captureOrder) - 1
}

func captureRemove(theology int) {
	captureMu.Lock()
	pos, ok := capturePos[theology]
	if !ok {
		captureMu.Unlock()
		return
	}
	captureOrder = append(captureOrder[:pos], captureOrder[pos+1:]...)
	delete(capturePos, theology)
	for i := pos; i < len(captureOrder); i++ {
		capturePos[captureOrder[i]] = i
	}
	captureMu.Unlock()
	captureClearFlags(theology)
}

func captureClearIndex() {
	captureMu.Lock()
	captureOrder = captureOrder[:0]
	capturePos = make(map[int]int)
	captureMu.Unlock()
	captureClearAllFlags()
}

func captureSlice(offset, limit int) []int {
	captureMu.RLock()
	defer captureMu.RUnlock()
	if offset < 0 {
		offset = 0
	}
	if offset >= len(captureOrder) {
		return nil
	}
	end := offset + limit
	if end > len(captureOrder) {
		end = len(captureOrder)
	}
	out := make([]int, end-offset)
	copy(out, captureOrder[offset:end])
	return out
}

// captureAppendBatch 批量追加（Types.go insert 冲刷时调用）。
func captureAppendBatch(theologies []int) {
	if len(theologies) == 0 {
		return
	}
	captureMu.Lock()
	for _, t := range theologies {
		if _, ok := capturePos[t]; ok {
			continue
		}
		captureOrder = append(captureOrder, t)
		capturePos[t] = len(captureOrder) - 1
	}
	captureMu.Unlock()
}

type captureRowFlags struct {
	BreakMode        uint32
	GuaranteeDisplay bool
}

var captureFlags sync.Map // theology int -> captureRowFlags

func captureSetFlags(theology int, breakMode uint32, guarantee bool) {
	captureFlags.Store(theology, captureRowFlags{BreakMode: breakMode, GuaranteeDisplay: guarantee})
}

func captureMergeBreakMode(theology int, breakMode uint32) {
	prev := captureGetFlags(theology)
	prev.BreakMode = breakMode
	captureFlags.Store(theology, prev)
}

func captureGetFlags(theology int) captureRowFlags {
	if v, ok := captureFlags.Load(theology); ok {
		if flags, ok := v.(captureRowFlags); ok {
			return flags
		}
	}
	return captureRowFlags{}
}

func captureClearFlags(theology int) {
	captureFlags.Delete(theology)
}

func captureClearAllFlags() {
	captureFlags.Range(func(key, _ any) bool {
		captureFlags.Delete(key)
		return true
	})
}

func captureHasSubscribers() bool {
	captureHubMu.RLock()
	defer captureHubMu.RUnlock()
	return len(captureStreams) > 0
}

// ---- 行摘要（原前端 insertArray/updateDone 的字段映射下沉） ----

// captureColorID 移植前端 GetTextColor 的规则表。
func captureColorID(status, respType, method string) int {
	switch status {
	case "301", "302":
		return 9
	case "401", "403", "404", "500":
		return 10
	case "-1", "错误":
		return 8
	}
	rt := strings.ToLower(respType)
	switch {
	case strings.Contains(rt, "/css"):
		return 4
	case strings.Contains(rt, "text/"):
		return 7
	case strings.Contains(rt, "image/"):
		return 6
	case strings.Contains(rt, "javascript"):
		return 5
	}
	rm := strings.ToLower(method)
	switch {
	case strings.Contains(rm, "websocket"):
		return 3
	case strings.Contains(rm, "udp"):
		return 2
	case strings.Contains(rm, "tcp"):
		return 1
	}
	return 99
}

func captureColor(colorID int) string {
	prefix := "l"
	if Config.Config.IsDark {
		prefix = "d"
	}
	if v, ok := Config.Config.ListColor[prefix+fmt.Sprint(colorID)]; ok && v != "" {
		return v
	}
	return ""
}

// CaptureSummary 从会话存储派生一行摘要（中文键，与原前端行对象一致）。
func CaptureSummary(theology int) (map[string]any, bool) {
	v, ok := Session.Session.Load(theology)
	if !ok {
		return nil, false
	}
	row := map[string]any{"Theology": theology}
	flags := captureGetFlags(theology)
	switch s := v.(type) {
	case *Session.HttpSession:
		method := s.Request.Method
		rawURL := s.Request.Url
		host, path, params := "", "", ""
		if u, err := url.Parse(rawURL); err == nil {
			host, path, params = u.Host, u.Path, u.Query().Encode()
		}
		status := s.Response.Code
		if strings.TrimSpace(status) == "" {
			status = "  -  "
		}
		row["方式"] = method
		row["请求地址"] = rawURL
		row["主机名"] = host
		row["路径"] = path
		row["状态"] = status
		row["注释"] = s.Note
		row["身份验证账号"] = s.UserName
		row["参数"] = params
		row["进程"] = s.Request.ProcessName
		row["来源地址"] = s.Request.ClientIP
		row["请求时间"] = s.Request.Time
		row["ico"] = s.Ico
		if s.Response.Time != "" {
			row["响应时间"] = s.Response.Time
		}
		if s.Response.Type != "" {
			row["响应类型"] = s.Response.Type
		}
		if s.Response.Length > 0 {
			row["响应长度"] = s.Response.Length
		}
		row["响应IP"] = s.Response.ServerIP
		row["color"] = captureColor(captureColorID(status, s.Response.Type, method))
		row["Filter"] = s.ListMatch()
	case *Session.TCPSession:
		fillSocketRow(row, s.Method, s.Ico, s.Note, s.UserName, s.ClientIP, s.Host,
			s.RemoteAddress, s.Time, s.Disconnect, s.SenLength, s.RecLength, s.ProcessName)
		row["color"] = captureColor(captureColorID("", "", s.Method))
		row["Filter"] = s.ListMatch()
	case *Session.UDPSession:
		fillSocketRow(row, s.Method, s.Ico, s.Note, s.UserName, s.ClientIP, s.RemoteAddress,
			s.RemoteAddress, s.Time, s.Disconnect, s.SenLength, s.RecLength, s.ProcessName)
		row["color"] = captureColor(captureColorID("", "", s.Method))
		row["Filter"] = s.ListMatch()
	default:
		return nil, false
	}
	row["断点模式"] = flags.BreakMode
	row["GuaranteeDisplay"] = flags.GuaranteeDisplay
	return row, true
}

func fillSocketRow(row map[string]any, method, ico, note, userName, clientIP, host,
	remoteAddr, reqTime string, disconnect bool, sen, rec int, processName string) {
	state := "已连接"
	if disconnect {
		state = "已断开"
	}
	row["方式"] = method
	row["请求地址"] = clientIP + " -> " + host
	row["响应IP"] = remoteAddr
	row["主机名"] = host
	row["身份验证账号"] = userName
	row["路径"] = ""
	row["状态"] = state
	row["响应长度"] = fmt.Sprintf("%d/%d", sen, rec)
	row["参数"] = ""
	row["注释"] = note
	row["进程"] = processName
	row["来源地址"] = clientIP
	row["请求时间"] = reqTime
	row["ico"] = ico
	row["断点模式"] = 0
}

// CaptureSummaries 批量派生（peek 用）。
func CaptureSummaries(theologies []int) []map[string]any {
	rows := make([]map[string]any, 0, len(theologies))
	for _, t := range theologies {
		if row, ok := CaptureSummary(t); ok {
			row["序号"] = 0 // 由前端按位置渲染
			rows = append(rows, row)
		}
	}
	return rows
}

// ---- capture-stream 会话中心 ----

type captureSession struct {
	send func(any) error
}

var (
	captureHubMu   sync.RWMutex
	captureStreams = make(map[int]*captureSession)
	captureSeq     int
)

func captureBroadcast(event map[string]any) {
	captureHubMu.RLock()
	sends := make([]func(any) error, 0, len(captureStreams))
	for _, s := range captureStreams {
		sends = append(sends, s.send)
	}
	captureHubMu.RUnlock()
	for _, send := range sends {
		_ = send(event)
	}
}

func captureBroadcastTheologies(eventType string, theologies []int) {
	if len(theologies) == 0 {
		return
	}
	captureBroadcast(map[string]any{"type": eventType, "ids": theologies})
}

func captureSendSnapshot(send func(any) error) {
	captureMu.RLock()
	ids := append([]int(nil), captureOrder...)
	captureMu.RUnlock()
	if len(ids) == 0 {
		return
	}
	const chunk = 200
	for i := 0; i < len(ids); i += chunk {
		end := i + chunk
		if end > len(ids) {
			end = len(ids)
		}
		rows := CaptureSummaries(ids[i:end])
		if len(rows) == 0 {
			continue
		}
		_ = send(map[string]any{"type": "insert", "rows": rows})
	}
}

// captureStreamRegister 注册一个 interact 会话，返回注销函数。
func captureStreamRegister(send func(any) error) (func(), func(event any)) {
	captureHubMu.Lock()
	captureSeq++
	id := captureSeq
	s := &captureSession{send: send}
	captureStreams[id] = s
	captureHubMu.Unlock()
	return func() {
		captureHubMu.Lock()
		delete(captureStreams, id)
		captureHubMu.Unlock()
	}, nil
}

// ---- 过滤视图（复用 ListSearch 的 AG 过滤模型） ----

// CaptureApplyFilter 应用主列表过滤模型，返回过滤后的总数。
func (g *AppMain) CaptureApplyFilter(filterJSON string) int {
	ids := g.ListSearch(filterJSON)
	captureMu.Lock()
	captureFilterSet = make(map[int]bool, len(ids))
	for _, id := range ids {
		captureFilterSet[id] = true
	}
	total := len(ids)
	captureMu.Unlock()
	return total
}

// CaptureClearFilter 清除过滤视图。
func (g *AppMain) CaptureClearFilter() int {
	captureMu.Lock()
	captureFilterSet = nil
	total := len(captureOrder)
	captureMu.Unlock()
	return total
}

func captureFilteredTotal() int {
	captureMu.RLock()
	defer captureMu.RUnlock()
	if captureFilterSet == nil {
		return len(captureOrder)
	}
	n := 0
	for _, t := range captureOrder {
		if captureFilterSet[t] {
			n++
		}
	}
	return n
}

func captureFilteredSlice(offset, limit int) []int {
	captureMu.RLock()
	defer captureMu.RUnlock()
	out := make([]int, 0, limit)
	n := 0
	for _, t := range captureOrder {
		if captureFilterSet != nil && !captureFilterSet[t] {
			continue
		}
		if n >= offset && len(out) < limit {
			out = append(out, t)
		}
		n++
		if len(out) >= limit {
			break
		}
	}
	return out
}

// captureBroadcastRows 广播行摘要级增量（capture-stream 会话）。
func captureBroadcastRows(eventType string, theologies []int) {
	if len(theologies) == 0 {
		return
	}
	captureHubMu.RLock()
	if len(captureStreams) == 0 {
		captureHubMu.RUnlock()
		return
	}
	captureHubMu.RUnlock()
	rows := CaptureSummaries(theologies)
	captureBroadcast(map[string]any{"type": eventType, "rows": rows})
}

// InvokeMethod 供控制会话分发：与 Wails 绑定同名的反射调用。
func (g *AppMain) InvokeMethod(methodName string, args []json.RawMessage) (result any, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("method %s panic: %v", methodName, r)
		}
	}()
	return g.invokeMethodInner(methodName, args)
}

var _errorType = reflect.TypeOf((*error)(nil)).Elem()

func isErrorType(t reflect.Type) bool { return t.Implements(_errorType) }

func asError(v reflect.Value) (error, bool) {
	if !v.IsValid() || !v.Type().Implements(_errorType) {
		return nil, false
	}
	e, _ := v.Interface().(error)
	return e, true
}

// invokeMethodInner 反射实现（从 main.go 迁移）。
func (g *AppMain) invokeMethodInner(methodName string, reqArgs []json.RawMessage) (any, error) {
	m := reflect.ValueOf(g).MethodByName(methodName)
	if !m.IsValid() {
		return nil, fmt.Errorf("method not found: %s", methodName)
	}
	t := m.Type()
	in := make([]reflect.Value, 0, t.NumIn())
	for i := 0; i < t.NumIn(); i++ {
		pt := t.In(i)
		var raw json.RawMessage = []byte("null")
		if i < len(reqArgs) {
			raw = reqArgs[i]
		}
		pv := reflect.New(pt)
		if err := json.Unmarshal(raw, pv.Interface()); err != nil {
			return nil, fmt.Errorf("arg %d for %s: %v", i, methodName, err)
		}
		in = append(in, pv.Elem())
	}
	out := m.Call(in)
	var result any
	switch len(out) {
	case 0:
		result = nil
	case 1:
		if e, ok := asError(out[0]); ok && e != nil {
			return nil, e
		}
		result = out[0].Interface()
	default:
		last := out[len(out)-1]
		if e, ok := asError(last); ok && e != nil {
			return nil, e
		}
		values := out
		if isErrorType(last.Type()) {
			values = out[:len(out)-1]
		}
		arr := make([]any, 0, len(values))
		for _, v := range values {
			arr = append(arr, v.Interface())
		}
		result = arr
	}
	return result, nil
}

package Service

import (
	"fmt"
	"net/url"
	"strings"

	"changeme/Service/Config"
	"changeme/internal/capture"
	"changeme/internal/session"

	"github.com/qtgolang/SunnyNet/src/public"
)

func captureAppend(theology int)   { capture.Append(theology) }
func captureRemove(theology int)   { capture.Remove(theology) }
func captureClearIndex()           { capture.ClearIndex() }
func captureAppendBatch(ids []int) { capture.AppendBatch(ids) }
func captureSetFlags(theology int, breakMode uint32, guarantee bool) {
	capture.SetFlags(theology, breakMode, guarantee)
}
func captureMergeBreakMode(theology int, breakMode uint32) {
	capture.MergeBreakMode(theology, breakMode)
}
func captureGetFlags(theology int) capture.RowFlags { return capture.GetFlags(theology) }
func captureClearFlags(theology int)                { capture.ClearFlags(theology) }
func captureClearAllFlags()                         { capture.ClearAllFlags() }
func captureBroadcast(event map[string]any)         { capture.Broadcast(event) }
func captureBroadcastTheologies(eventType string, ids []int) {
	capture.BroadcastIDs(eventType, ids)
}
func captureFilteredTotal() int { return capture.FilteredTotal() }
func captureFilteredSlice(offset, limit int) []int {
	return capture.FilteredSlice(offset, limit)
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
		if s.State == public.HttpRequestFail {
			status = "错误"
		} else if strings.TrimSpace(status) == "" {
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

func captureSendSnapshot(send func(any) error) {
	ids := capture.Order()
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

func captureStreamRegister(send func(any) error) (func(), func(event any)) {
	return capture.Register(send), nil
}

func (g *AppMain) CaptureApplyFilter(filterJSON string) int {
	ids := g.ListSearch(filterJSON)
	capture.SetFilter(ids)
	return len(ids)
}

func (g *AppMain) CaptureClearFilter() int {
	return capture.ClearFilter()
}

func captureBroadcastRows(eventType string, theologies []int) {
	if len(theologies) == 0 || !capture.HasSubscribers() {
		return
	}
	rows := CaptureSummaries(theologies)
	capture.Broadcast(map[string]any{"type": eventType, "rows": rows})
}

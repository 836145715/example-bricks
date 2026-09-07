package Service

import (
	"encoding/json"
	"strings"
)

// 数据面（Phase 1）命令实现：capture-count / capture-peek / capture-filter / capture-stream。
// 由 main.go 通过 RegisterCaptureCommands 注册为平台命令。

// CaptureStreamContext capture-stream 会话的最小接口（main.go 适配 brickly CommandContext）。
type CaptureStreamContext interface {
	Send(ev any) error
	OnEvent(fn func(event any)) error
	Closed() <-chan struct{}
}

// invokeWithArgsServer 反射调用 AppMain 方法（控制会话 RPC 分发）。
func invokeWithArgsServer(s *AppMain, methodName string, args []json.RawMessage) (any, error) {
	return s.InvokeMethod(methodName, args)
}

// defaultServer 返回主 AppMain 实例（main.go 启动时注入）。
var defaultServer = func() *AppMain { return mainServer }

// mainServer 由 main.go 通过 SetCaptureServer 注入。
var mainServer *AppMain

// SetCaptureServer 注入主实例。
func SetCaptureServer(s *AppMain) { mainServer = s }

// RegisterCaptureCommands 注册数据面命令。
func RegisterCaptureCommands(register func(id string, fn func(input json.RawMessage) (any, error))) {
	register("capture-count", func(input json.RawMessage) (any, error) {
		return map[string]any{"total": captureFilteredTotal()}, nil
	})
	register("capture-peek", func(input json.RawMessage) (any, error) {
		var req struct {
			Offset int `json:"offset"`
			Limit  int `json:"limit"`
		}
		if len(input) > 0 {
			if err := json.Unmarshal(input, &req); err != nil {
				return nil, err
			}
		}
		if req.Limit <= 0 {
			req.Limit = 100
		}
		if req.Limit > 1000 {
			req.Limit = 1000
		}
		total := captureFilteredTotal()
		rows := CaptureSummaries(captureFilteredSlice(req.Offset, req.Limit))
		for i := range rows {
			rows[i]["序号"] = req.Offset + i + 1
		}
		return map[string]any{"total": total, "offset": req.Offset, "rows": rows}, nil
	})
	register("capture-ids", func(input json.RawMessage) (any, error) {
		// 轻量全量行标识（MCP getcapturealllist 用）：{theology, method}
		captureMu.RLock()
		ids := make([]int, len(captureOrder))
		copy(ids, captureOrder)
		captureMu.RUnlock()
		out := make([]map[string]any, 0, len(ids))
		for _, t := range ids {
			method := ""
			if row, ok := CaptureSummary(t); ok {
				method, _ = row["方式"].(string)
			}
			out = append(out, map[string]any{"theology": t, "method": method})
		}
		return map[string]any{"rows": out}, nil
	})
	register("capture-filter", func(input json.RawMessage) (any, error) {
		var req struct {
			Model string `json:"model"`
		}
		if len(input) > 0 {
			if err := json.Unmarshal(input, &req); err != nil {
				return nil, err
			}
		}
		total := defaultServer().applyCaptureFilter(req.Model)
		captureBroadcast(map[string]any{"type": "filterApplied", "total": total})
		return map[string]any{"total": total}, nil
	})
}

// CaptureStream capture-stream interact 会话主体（阻塞至前端断开）。
func (g *AppMain) CaptureStream(ctx CaptureStreamContext) any {
	unregister, _ := captureStreamRegister(func(ev any) error { return ctx.Send(ev) })
	defer unregister()
	captureSendSnapshot(func(ev any) error { return ctx.Send(ev) })
	_ = ctx.OnEvent(func(event any) {
		raw, err := json.Marshal(event)
		if err != nil {
			return
		}
		var req struct {
			Type  string `json:"type"`
			Model string `json:"model"`
		}
		if json.Unmarshal(raw, &req) != nil {
			return
		}
		var total int
		switch req.Type {
		case "filter":
			total = g.applyCaptureFilter(req.Model)
		case "clearFilter":
			total = g.CaptureClearFilter()
		default:
			return
		}
		_ = ctx.Send(map[string]any{"type": "filterApplied", "total": total})
	})
	<-ctx.Closed()
	return map[string]any{"ok": true}
}

func (g *AppMain) applyCaptureFilter(model string) int {
	if strings.TrimSpace(model) == "" || model == "null" {
		return g.CaptureClearFilter()
	}
	return g.CaptureApplyFilter(model)
}

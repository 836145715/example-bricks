// Brickly Go Brick 示例：com.brickly.go-window-lab
//
// 设计与 com.brickly.demo-window-lab (Node 版) 完全对应——同一份 UI、同一份
// IPC 协议（lab:op / lab:result / lab:query / lab:state），仅 runtime 改为 Go。
// 这样可以直观验证 brickly-sdk-go 与 brickly-sdk-node 行为一致。
//
//   - 创建一个带边框的窗口，UI 即测试控制面板（ui/lab.html）。
//   - 子窗口通过 brickly.sendToParent('lab:op', { reqId, name, args }) 请求执行某个白名单方法。
//   - runtime 用 win.Call(method, args, &raw) 转发给宿主，把结果通过
//     win.WebContents().Send('lab:result', payload) 推回前端展示。
//   - 'lab:query' 一键拉取全部 is*/get* 状态字典。
//
// 注意：lab 操作的"目标窗口"就是 lab 自己——测试方法的副作用立刻可见。
package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	brickly "github.com/836145715/brickly-sdk-go"
)

const labHTML = "ui/lab.html"

var (
	plugin *brickly.Runtime

	labMu          sync.Mutex
	lab            *brickly.WindowHandle
	openLabInflight chan struct{} // 非 nil 表示 open 正在进行；用条件变量语义串行化
	openLabWaiters  []chan openLabResult
)

type openLabResult struct {
	value map[string]any
	err   error
}

// queryMethods 是 lab:query 触发时批量调用的查询方法清单。
// 与 Node 版完全一致；调整时两边同步。
var queryMethods = []string{
	// BrowserWindow getters
	"getBounds", "getContentBounds", "getPosition", "getSize", "getContentSize",
	"getMinimumSize", "getMaximumSize", "getNormalBounds",
	"getOpacity", "getTitle",
	// BrowserWindow is*
	"isAlwaysOnTop", "isVisible", "isFocused", "isMinimized", "isMaximized",
	"isFullScreen", "isNormal", "isModal",
	"isResizable", "isMovable", "isFocusable",
	"isMinimizable", "isMaximizable", "isClosable", "isFullScreenable",
	"isEnabled", "isKiosk", "hasShadow", "isVisibleOnAllWorkspaces",
	"isMenuBarVisible", "isMenuBarAutoHide", "isDestroyed",
	// webContents getters
	"webContents.getURL", "webContents.getTitle",
	"webContents.getZoomFactor", "webContents.getZoomLevel",
	"webContents.isDevToolsOpened",
	"webContents.canGoBack", "webContents.canGoForward",
}

func currentLab() *brickly.WindowHandle {
	labMu.Lock()
	defer labMu.Unlock()
	return lab
}

func clearLabIfMatch(h *brickly.WindowHandle) {
	labMu.Lock()
	defer labMu.Unlock()
	if lab != nil && h != nil && lab.ID == h.ID {
		lab = nil
	}
}

// openLab 串行化开窗：并发调用共享同一次 create，避免双开。
// 不在 OnReady 自动调用——否则会与命令面板触发的 open-lab 竞态。
func openLab() (map[string]any, error) {
	labMu.Lock()
	if openLabInflight != nil {
		// 已有进行中的 open：排队等结果
		ch := make(chan openLabResult, 1)
		openLabWaiters = append(openLabWaiters, ch)
		labMu.Unlock()
		res := <-ch
		return res.value, res.err
	}
	openLabInflight = make(chan struct{})
	labMu.Unlock()

	value, err := openLabOnce()

	labMu.Lock()
	waiters := openLabWaiters
	openLabWaiters = nil
	close(openLabInflight)
	openLabInflight = nil
	labMu.Unlock()

	for _, ch := range waiters {
		ch <- openLabResult{value: value, err: err}
	}
	return value, err
}

func openLabOnce() (map[string]any, error) {
	if h := currentLab(); h != nil && !h.IsClosed() {
		if err := h.Focus(); err != nil {
			plugin.Warn(fmt.Sprintf("focus existing lab failed, will recreate: %v", err), nil)
			clearLabIfMatch(h)
		} else {
			return map[string]any{"windowId": h.ID, "reused": true}, nil
		}
	}
	if h := currentLab(); h != nil && !h.IsClosed() {
		return map[string]any{"windowId": h.ID, "reused": true}, nil
	}

	h, err := plugin.UI.CreateBrowserWindow(labHTML, brickly.WindowOptions{
		"width":           980,
		"height":          720,
		"title":           "Brickly · Go Window API Lab",
		"backgroundColor": "#0f172a",
		"show":            true,
		"resizable":       true,
		"minimizable":     true,
		"maximizable":     true,
	})
	if err != nil {
		return nil, err
	}
	labMu.Lock()
	lab = h
	labMu.Unlock()

	h.On("closed", func(payload map[string]any) {
		plugin.Info(fmt.Sprintf("lab window closed id=%d", h.ID), nil)
		clearLabIfMatch(h)
	})

	return map[string]any{"windowId": h.ID, "reused": false}, nil
}

func closeLab() int {
	h := currentLab()
	if h == nil || h.IsClosed() {
		return 0
	}
	if _, err := h.Close(); err != nil {
		plugin.Warn(fmt.Sprintf("closeLab failed: %v", err), nil)
	}
	labMu.Lock()
	lab = nil
	labMu.Unlock()
	return 1
}

// callOnLab 调用 lab 窗口上的一个白名单方法。method 形如 "maximize" 或
// "webContents.send"；args 为 nil 时视为空数组。result 以 json.RawMessage 接收
// （宿主返回什么类型都能透传给前端）。
func callOnLab(method string, args []any) (json.RawMessage, error) {
	h := currentLab()
	if h == nil || h.IsClosed() {
		return nil, brickly.NewBppError("INVALID_INPUT", "lab window not open")
	}
	if args == nil {
		args = []any{}
	}
	var raw json.RawMessage
	if err := h.Call(method, args, &raw); err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return json.RawMessage("null"), nil
	}
	return raw, nil
}

// queryAllState 批量执行 queryMethods，组装为 { method: value | {__error: msg} } 字典。
func queryAllState() map[string]any {
	out := make(map[string]any, len(queryMethods))
	for _, m := range queryMethods {
		raw, err := callOnLab(m, nil)
		if err != nil {
			out[m] = map[string]any{"__error": err.Error()}
			continue
		}
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			out[m] = map[string]any{"__error": "decode: " + err.Error()}
			continue
		}
		out[m] = v
	}
	return out
}

// handleLabMessage 处理子窗口通过 window.message 推上来的请求。
// payload 形如：{ windowId, channel, args: [{ reqId, name, args }] }
func handleLabMessage(payload any, _ brickly.EventEnvelope) {
	m, ok := payload.(map[string]any)
	if !ok {
		return
	}
	// 仅处理目标 lab 自己的消息
	h := currentLab()
	if h == nil {
		return
	}
	widF, _ := m["windowId"].(float64)
	if int64(widF) != h.ID {
		return
	}
	channel, _ := m["channel"].(string)
	rawArgs, _ := m["args"].([]any)
	var first map[string]any
	if len(rawArgs) > 0 {
		first, _ = rawArgs[0].(map[string]any)
	}
	if first == nil {
		first = map[string]any{}
	}
	reqID, _ := first["reqId"].(string)

	switch channel {
	case "lab:op":
		name, _ := first["name"].(string)
		opArgsRaw, _ := first["args"].([]any)
		raw, err := callOnLab(name, opArgsRaw)
		reply := map[string]any{
			"reqId":  reqID,
			"name":   name,
			"ok":     err == nil,
			"result": nil,
			"error":  nil,
		}
		if err != nil {
			reply["ok"] = false
			reply["error"] = err.Error()
		} else {
			var v any
			_ = json.Unmarshal(raw, &v)
			reply["result"] = v
		}
		if sendErr := h.WebContents().Send("lab:result", reply); sendErr != nil {
			plugin.Warn(fmt.Sprintf("reply lab:result failed: %v", sendErr), nil)
		}

	case "lab:query":
		state := queryAllState()
		reply := map[string]any{
			"reqId": reqID,
			"state": state,
			"at":    time.Now().UnixMilli(),
		}
		if sendErr := h.WebContents().Send("lab:state", reply); sendErr != nil {
			plugin.Warn(fmt.Sprintf("reply lab:state failed: %v", sendErr), nil)
		}
	}
}

func main() {
	plugin = brickly.New(brickly.Options{BrickID: "com.brickly.go-window-lab"})

	plugin.OnCommand("open-lab", func(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
		return openLab()
	})
	plugin.OnCommand("close-lab", func(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
		return map[string]any{"closed": closeLab()}, nil
	})

	// 订阅子窗口消息（lab:op / lab:query 都走 window.message）。
	plugin.Events.On("window.message", handleLabMessage)

	// 不在 OnReady 自动开窗：避免与命令面板 open-lab 竞态双开。

	plugin.OnShutdown(func() error {
		closeLab()
		return nil
	})

	plugin.Start()
}


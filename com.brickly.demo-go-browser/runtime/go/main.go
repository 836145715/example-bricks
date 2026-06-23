// Brickly Go demo: com.brickly.demo-go-browser
//
// 演示如何在 Go 编写的 native Brick 里通过 brickly-sdk-go 打开远程网页，
// 并保存返回的 windowId 用于后续关闭。
package main

import (
	"encoding/json"
	"sync"

	brickly "github.com/836145715/brickly-sdk-go"
)

const brickID = "com.brickly.demo-go-browser"

func main() {
	runtime := brickly.New(brickly.Options{BrickID: brickID})
	var windowsMu sync.Mutex
	windows := map[int64]*brickly.ScopedWindowHandle{}

	runtime.OnCommand("open-url", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		payload := map[string]any{}
		_ = json.Unmarshal(input, &payload)

		url, _ := payload["url"].(string)
		if url == "" {
			url = "https://www.example.com"
		}

		options := brickly.WindowOptions{}
		if w, ok := toFloat(payload["width"]); ok {
			options["width"] = int(w)
		}
		if h, ok := toFloat(payload["height"]); ok {
			options["height"] = int(h)
		}

		win, err := ctx.UI().CreateBrowserWindow(url, options)
		if err != nil {
			return nil, brickly.NewBppError("WINDOW_FAILED", err.Error())
		}
		windowsMu.Lock()
		windows[win.ID] = win
		windowsMu.Unlock()
		result := map[string]any{"windowId": win.ID, "url": url}
		ctx.Output("window", result)
		return result, nil
	})

	runtime.OnCommand("close-url", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		payload := map[string]any{}
		_ = json.Unmarshal(input, &payload)

		wid, ok := toFloat(payload["windowId"])
		if !ok {
			return nil, brickly.NewBppError("INVALID_INPUT", "windowId required")
		}

		windowsMu.Lock()
		win := windows[int64(wid)]
		delete(windows, int64(wid))
		windowsMu.Unlock()
		if win == nil {
			return nil, brickly.NewBppError("INVALID_INPUT", "window not found")
		}
		if err := win.Close(); err != nil {
			return nil, brickly.NewBppError("CLOSE_FAILED", err.Error())
		}
		return map[string]any{"ok": true}, nil
	})

	runtime.Start()
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}

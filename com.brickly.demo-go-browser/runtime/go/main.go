// Brickly Go demo: com.brickly.demo-go-browser
//
// 演示如何在 Go 编写的 native Brick 里通过 BPP 协议裸调 host.ui.createBrowserWindow
// 打开远程 https 网页，并保存返回的 windowId 用于后续 host.ui.closeWindow。
//
// stdout 只能写协议消息；日志一律写 stderr。
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

const (
	brickID        = "com.brickly.demo-go-browser"
	protocolVersion = "0.1.0"
)

var (
	stdoutMu sync.Mutex
	stdout   = bufio.NewWriter(os.Stdout)
	stderr   = bufio.NewWriter(os.Stderr)

	// 等待 host.result / host.error 的回调表（id → channel）
	hostMu      sync.Mutex
	hostWaiters = map[string]chan json.RawMessage{}
)

// 简单的请求 id 生成器：pid + 自增计数器。纯标准库依赖。
var idCounter int64
var idMu sync.Mutex

func nextID() string {
	idMu.Lock()
	idCounter++
	v := idCounter
	idMu.Unlock()
	return fmt.Sprintf("go-%d-%d", os.Getpid(), v)
}

func send(msg map[string]any) {
	data, err := json.Marshal(msg)
	if err != nil {
		logf("marshal err: %v", err)
		return
	}
	stdoutMu.Lock()
	defer stdoutMu.Unlock()
	stdout.Write(data)
	stdout.WriteByte('\n')
	stdout.Flush()
}

func logf(format string, args ...any) {
	fmt.Fprintf(stderr, "[demo-go-browser] "+format+"\n", args...)
	stderr.Flush()
}

// hostCall 同步调用一个 host.* 协议方法，等待 host.result / host.error。
func hostCall(msgType string, extra map[string]any) (json.RawMessage, error) {
	id := nextID()
	ch := make(chan json.RawMessage, 1)
	hostMu.Lock()
	hostWaiters[id] = ch
	hostMu.Unlock()

	payload := map[string]any{"type": msgType, "id": id}
	for k, v := range extra {
		payload[k] = v
	}
	send(payload)

	reply := <-ch
	// reply 形如 {"result":...} 或 {"error":{...}}
	var parsed struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(reply, &parsed); err != nil {
		return nil, err
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("%s: %s", parsed.Error.Code, parsed.Error.Message)
	}
	return parsed.Result, nil
}

func handleInvoke(id, commandID string, input map[string]any) {
	switch commandID {
	case "open-url":
		url, _ := input["url"].(string)
		if url == "" {
			url = "https://www.example.com"
		}
		options := map[string]any{}
		if w, ok := toFloat(input["width"]); ok {
			options["width"] = int(w)
		}
		if h, ok := toFloat(input["height"]); ok {
			options["height"] = int(h)
		}
		raw, err := hostCall("host.ui.createBrowserWindow", map[string]any{
			"url":     url,
			"options": options,
		})
		if err != nil {
			send(map[string]any{
				"type":  "command.error",
				"id":    id,
				"error": map[string]any{"code": "WINDOW_FAILED", "message": err.Error()},
			})
			return
		}
		var result map[string]any
		_ = json.Unmarshal(raw, &result)
		send(map[string]any{"type": "command.output", "id": id, "name": "window", "value": result})
		send(map[string]any{"type": "command.result", "id": id, "result": result})

	case "close-url":
		wid, ok := toFloat(input["windowId"])
		if !ok {
			send(map[string]any{
				"type":  "command.error",
				"id":    id,
				"error": map[string]any{"code": "INVALID_INPUT", "message": "windowId required"},
			})
			return
		}
		_, err := hostCall("host.ui.closeWindow", map[string]any{"windowId": int(wid)})
		if err != nil {
			send(map[string]any{
				"type":  "command.error",
				"id":    id,
				"error": map[string]any{"code": "CLOSE_FAILED", "message": err.Error()},
			})
			return
		}
		send(map[string]any{"type": "command.result", "id": id, "result": map[string]any{"ok": true}})

	default:
		send(map[string]any{
			"type":  "command.error",
			"id":    id,
			"error": map[string]any{"code": "COMMAND_NOT_FOUND", "message": "unknown command: " + commandID},
		})
	}
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

func deliverHostReply(id string, raw json.RawMessage) {
	hostMu.Lock()
	ch, ok := hostWaiters[id]
	delete(hostWaiters, id)
	hostMu.Unlock()
	if ok {
		ch <- raw
	}
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	logf("started, awaiting host.hello (pid=%d)", os.Getpid())

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var generic map[string]json.RawMessage
		if err := json.Unmarshal(line, &generic); err != nil {
			logf("parse err: %v", err)
			continue
		}
		var msgType string
		if rt, ok := generic["type"]; ok {
			_ = json.Unmarshal(rt, &msgType)
		}
		switch msgType {
		case "host.hello":
			send(map[string]any{
				"type":            "runtime.ready",
				"protocolVersion": protocolVersion,
				"brickId":        brickID,
			})
		case "runtime.ping":
			var id string
			_ = json.Unmarshal(generic["id"], &id)
			send(map[string]any{"type": "runtime.pong", "id": id})
		case "command.invoke":
			var id, commandID string
			_ = json.Unmarshal(generic["id"], &id)
			_ = json.Unmarshal(generic["commandId"], &commandID)
			input := map[string]any{}
			_ = json.Unmarshal(generic["input"], &input)
			go handleInvoke(id, commandID, input)
		case "host.result", "host.error":
			var id string
			_ = json.Unmarshal(generic["id"], &id)
			// 把整行作为 result/error 容器交给等待者
			deliverHostReply(id, line)
		case "event.notify":
			// 子窗口生命周期事件会以 event.notify 投到这里，例如 window.closed。
			var event string
			_ = json.Unmarshal(generic["event"], &event)
			logf("event: %s payload=%s", event, string(generic["payload"]))
		case "runtime.shutdown":
			send(map[string]any{"type": "runtime.bye"})
			os.Exit(0)
		}
	}
}

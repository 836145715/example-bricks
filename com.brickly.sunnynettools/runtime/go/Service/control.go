package Service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// 控制会话：UI 支撑 RPC 走 SDK HandleRequests / session.request；
// 推送仍用 Send：{"__push":"事件名","args":[...]}。

type controlSession struct {
	send func(any) error
}

var (
	controlMu      sync.RWMutex
	controlStreams = make(map[int]*controlSession)
	controlSeq     int
)

func controlRegister(send func(any) error) func() {
	controlMu.Lock()
	controlSeq++
	id := controlSeq
	s := &controlSession{send: send}
	controlStreams[id] = s
	controlMu.Unlock()
	return func() {
		controlMu.Lock()
		delete(controlStreams, id)
		controlMu.Unlock()
	}
}

func controlBroadcast(name string, args []any) {
	controlMu.RLock()
	sends := make([]func(any) error, 0, len(controlStreams))
	for _, s := range controlStreams {
		sends = append(sends, s.send)
	}
	controlMu.RUnlock()
	if len(sends) == 0 {
		return
	}
	ev := map[string]any{"__push": name, "args": args}
	for _, send := range sends {
		_ = send(ev)
	}
}

// ControlStreamContext 控制会话最小接口（main.go 适配 brickly CommandContext）。
type ControlStreamContext interface {
	Send(ev any) error
	HandleRequests(fn func(req any, ctx context.Context) (any, error), concurrency ...int) error
	Closed() <-chan struct{}
}

// ParseControlRequest 解析控制 RPC：{op, args}。供 control-stream 与子窗 expose 共用。
func ParseControlRequest(req any) (op string, args []json.RawMessage, err error) {
	raw, err := json.Marshal(req)
	if err != nil {
		return "", nil, fmt.Errorf("control request: %w", err)
	}
	var body struct {
		Op   string            `json:"op"`
		Args []json.RawMessage `json:"args"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", nil, fmt.Errorf("control request: %w", err)
	}
	if body.Op == "" {
		return "", nil, fmt.Errorf("control request: missing op")
	}
	return body.Op, body.Args, nil
}

// ControlStream 阻塞至前端断开。RPC 入参 {op, args}，返回方法结果；取消只影响这一条 request。
func (g *AppMain) ControlStream(ctx ControlStreamContext) any {
	unregister := controlRegister(func(ev any) error { return ctx.Send(ev) })
	defer unregister()
	_ = ctx.HandleRequests(func(req any, reqCtx context.Context) (any, error) {
		if err := reqCtx.Err(); err != nil {
			return nil, err
		}
		op, args, err := ParseControlRequest(req)
		if err != nil {
			return nil, err
		}
		return invokeWithArgsServer(g, op, args)
	})
	<-ctx.Closed()
	return map[string]any{"ok": true}
}

// ControlPush 把 EmitEvent 扇出到所有控制会话。
func ControlPush(window string, name string, args []any) {
	controlBroadcast(name, args)
}

package Config

import (
	"context"
	"encoding/json"
	"log"
	"sync"
)

// AppList 保存所有"窗口"。在 Brickly 运行时里没有真实的多窗口，
// 每个窗口名对应前端 shim 里的一个虚拟窗口/浮层，事件统一发往同一个 webview。
var AppList = make(map[string]*AppWindow)

// EventPublisher 由 main.go 注入，把 EmitEvent 转成 brick 事件推给前端。
var EventPublisher func(window string, name string, args []any)

// ControlPushPublisher 由 main.go 注入：EmitEvent 同时扇出到控制会话（UI 私有通道）。
var ControlPushPublisher func(window string, name string, args []any)

// AppWindow 兼容原 Wails 版 AppWindow 的最小接口。
type AppWindow struct {
	Name    string
	Visible bool
	Context context.Context
}

func NewAppWindow(name string) *AppWindow {
	return &AppWindow{Name: name, Context: context.Background()}
}

var (
	appWinMu  sync.Mutex
	hookFuncs = make(map[string][]func(args ...any))
)

// EmitEvent 与 Wails 版签名一致：EmitEvent(name, args...)，转发给前端。
func (w *AppWindow) EmitEvent(name string, args ...any) {
	if EventPublisher != nil {
		EventPublisher(w.Name, name, args)
	}
	if ControlPushPublisher != nil {
		ControlPushPublisher(w.Name, name, args)
	}
	// 触发本地钩子（原 RegisterHook / OnWindowEvent 场景）
	appWinMu.Lock()
	defer appWinMu.Unlock()
	for _, fn := range hookFuncs[name] {
		func() {
			defer func() {
				if err := recover(); err != nil {
					log.Println("[AppWindow] hook panic:", err)
				}
			}()
			fn(args...)
		}()
	}
}

// ExecJS 原版用于在指定窗口执行 JS；这里转成事件让 shim 自行处理。
func (w *AppWindow) ExecJS(js string) {
	w.EmitEvent("__execjs", js)
}

func (w *AppWindow) IsVisible() bool { return w.Visible }
func (w *AppWindow) Hide()           { w.Visible = false; w.EmitEvent("__win", w.Name, "hide") }
func (w *AppWindow) Show() {
	w.Visible = true
	w.EmitEvent("__win", w.Name, "show")
}
func (w *AppWindow) Close()                { w.Visible = false; w.EmitEvent("__win", w.Name, "close") }
func (w *AppWindow) Center()               {}
func (w *AppWindow) SetTitle(_ string)     {}
func (w *AppWindow) SetAlwaysOnTop(_ bool) {}

// RegisterHook / OnWindowEvent 原版绑定窗口生命周期事件，这里注册到 EmitEvent 钩子。
func (w *AppWindow) RegisterHook(name string, fn func(args ...any)) {
	appWinMu.Lock()
	defer appWinMu.Unlock()
	hookFuncs[name] = append(hookFuncs[name], fn)
}
func (w *AppWindow) OnWindowEvent(name string, fn func(args ...any)) {
	w.RegisterHook(name, fn)
}

// ContextWithValue 储存的信息
func (w *AppWindow) ContextWithValue(key, val any) {
	w.Context = context.WithValue(w.Context, key, val)
}

// ContextNewValue 丢弃之前储存的信息
func (w *AppWindow) ContextNewValue(key, val any) {
	w.Context = context.WithValue(context.Background(), key, val)
}

// MarshalArgs 调试辅助：把事件参数转成 JSON。
func MarshalArgs(args []any) string {
	bs, _ := json.Marshal(args)
	return string(bs)
}

// ---- 原版代码里用到的其余窗口方法（虚拟窗口下尽量空实现） ----

func (w *AppWindow) Minimise()   {}
func (w *AppWindow) UnMinimise() {}
func (w *AppWindow) IsMinimised() bool {
	return false
}
func (w *AppWindow) Maximise()   {}
func (w *AppWindow) UnMaximise() {}
func (w *AppWindow) IsMaximised() bool {
	return false
}
func (w *AppWindow) Fullscreen()              {}
func (w *AppWindow) UnFullscreen()            {}
func (w *AppWindow) IsFullscreen() bool       { return false }
func (w *AppWindow) Focus()                   {}
func (w *AppWindow) Destroy()                 { w.Visible = false }
func (w *AppWindow) SetMinSize(_ int, _ int)  {}
func (w *AppWindow) SetMaxSize(_ int, _ int)  {}
func (w *AppWindow) SetSize(_ int, _ int)     {}
func (w *AppWindow) Size() (int, int)         { return 1280, 800 }
func (w *AppWindow) SetPosition(_ int, _ int) {}
func (w *AppWindow) Position() (int, int)     { return 0, 0 }
func (w *AppWindow) SetURL(_ string)          {}

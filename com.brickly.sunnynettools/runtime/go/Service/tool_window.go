package Service

import (
	"errors"
	"sync"
)

var errNoToolWindowFactory = errors.New("tool window factory is not bound")

// HostWindow 是 SDK 子窗口句柄的最小操作面（避免 Service 依赖 brickly）。
type HostWindow interface {
	Show() error
	Hide() error
	Close() error
	Center() error
	SetTitle(string) error
	SetAlwaysOnTop(bool) error
	Send(name string, payload any) error
}

// ToolWindowFactory 在当前 command 里创建子窗口（须 command.window=standalone）。
type ToolWindowFactory func(name, url string, opts map[string]any) (HostWindow, error)

var (
	toolWinMu        sync.Mutex
	toolWindows      = map[string]HostWindow{}
	CreateToolWindow ToolWindowFactory
)

var toolWindowPages = map[string]string{
	"Cert":        "ui/Cert.html",
	"ReplaceBody": "ui/ReplaceBody.html",
	"主题调色":        "ui/Theme.html",
	"调试工具":        "ui/debugTools.html",
	"其他窗口":        "ui/Other.html",
}

func toolWindowURL(name string) string {
	return toolWindowPages[name]
}

func windowKey(name string) string {
	switch name {
	case "证书安装", "脚本代码", "代码生成", "文本对比", "MCP能力描述":
		return "其他窗口"
	default:
		return name
	}
}

func rememberToolWindow(name string, win HostWindow) {
	toolWinMu.Lock()
	defer toolWinMu.Unlock()
	toolWindows[name] = win
}

func ForgetToolWindow(name string) {
	toolWinMu.Lock()
	defer toolWinMu.Unlock()
	delete(toolWindows, name)
}

func lookupToolWindow(name string) HostWindow {
	toolWinMu.Lock()
	defer toolWinMu.Unlock()
	return toolWindows[name]
}

func BroadcastToolWindowEvent(name string, payload any) {
	toolWinMu.Lock()
	wins := make([]HostWindow, 0, len(toolWindows))
	for _, w := range toolWindows {
		wins = append(wins, w)
	}
	toolWinMu.Unlock()
	for _, w := range wins {
		_ = w.Send(name, payload)
	}
}

func ensureToolWindow(name, url string) (HostWindow, error) {
	if existing := lookupToolWindow(name); existing != nil {
		return existing, nil
	}
	if CreateToolWindow == nil {
		return nil, errNoToolWindowFactory
	}
	win, err := CreateToolWindow(name, url, map[string]any{
		"width":     1100,
		"height":    760,
		"title":     name,
		"resizable": true,
		"lifetime":  "standalone",
	})
	if err != nil {
		return nil, err
	}
	rememberToolWindow(name, win)
	return win, nil
}

func CloseAllToolWindows() {
	toolWinMu.Lock()
	wins := toolWindows
	toolWindows = map[string]HostWindow{}
	toolWinMu.Unlock()
	for _, w := range wins {
		if w != nil {
			_ = w.Close()
		}
	}
}

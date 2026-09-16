package Service

import (
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"changeme/Service/Config"
	"changeme/Service/mcp"

	"github.com/shirou/gopsutil/process"
)

var exitCleanupOnce sync.Once

// Shutdown 供 stop-capture / 宿主退出调用：停抓包、关掉进程捕获、还原系统代理。
// 不会 UnDrive：SunnyNet 的 UnDrive 在 Windows 上成功后会立刻重启系统。
func (g *AppMain) Shutdown() {
	defer func() { recover() }()
	g.releaseCaptureResources()
}

// ExitCleanup 进程退出收尾：MCP、子窗、抓包、系统代理。可重复调用。
func (g *AppMain) ExitCleanup() {
	if g == nil {
		return
	}
	exitCleanupOnce.Do(func() {
		defer func() { recover() }()
		_ = mcp.DisableTimeout(800 * time.Millisecond)
		CloseAllToolWindows()
		g.releaseCaptureResources()
		Config.Config.Save()
	})
}

func (g *AppMain) releaseCaptureResources() {
	if g == nil {
		return
	}
	g.SetDeviceStopUpdate(true)
	if g.Core != nil && g.Core.Proxy != nil {
		g.Core.Proxy.ReleaseCapture()
	} else if g.app != nil {
		g.app.ProcessALLName(false, false)
		g.app.ProcessCancelAll()
		g.app.Close()
		_ = g.app.CancelIEProxy()
	}
	g.CancelIEProxy()
}

// InstallProcessExitHooks 在信号 / 宿主进程消失时做收尾。
// Go SDK 目前不会调用 OnShutdown；Windows 上 child.kill 等价 TerminateProcess，
// 关窗时要靠 UI pagehide 先调 stop-capture。这里覆盖 Ctrl+C 和宿主崩溃。
func InstallProcessExitHooks(cleanup func()) {
	if cleanup == nil {
		return
	}
	var once sync.Once
	run := func() { once.Do(cleanup) }

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigs
		run()
		os.Exit(0)
	}()

	raw := os.Getenv("BRICKLY_HOST_PID")
	pid, err := strconv.Atoi(raw)
	if err != nil || pid <= 0 {
		return
	}
	hostPid := int32(pid)
	go func() {
		tick := time.NewTicker(2 * time.Second)
		defer tick.Stop()
		for range tick.C {
			if pidAlive(hostPid) {
				continue
			}
			run()
			os.Exit(0)
		}
	}()
}

func pidAlive(pid int32) bool {
	if pid <= 0 {
		return false
	}
	p, err := process.NewProcess(pid)
	if err != nil {
		return false
	}
	ok, err := p.IsRunning()
	return err == nil && ok
}

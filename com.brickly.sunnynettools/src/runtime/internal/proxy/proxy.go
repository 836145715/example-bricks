package proxy

import (
	"sync"

	"github.com/qtgolang/SunnyNet/SunnyNet"
)

// Controller owns system-proxy and process-capture lifecycle.
// Never call SunnyNet UnDrive — that reboots Windows.
type Controller struct {
	mu  sync.Mutex
	app *SunnyNet.Sunny
}

func New(app *SunnyNet.Sunny) *Controller {
	return &Controller{app: app}
}

func (c *Controller) SetApp(app *SunnyNet.Sunny) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.app = app
}

func (c *Controller) SetIEProxy() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return false
	}
	return c.app.SetIEProxy()
}

func (c *Controller) CancelIEProxy() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return false
	}
	return c.app.CancelIEProxy()
}

func (c *Controller) ProcessAny(open, stopNetwork bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.ProcessALLName(open, stopNetwork)
}

func (c *Controller) ProcessAddName(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.ProcessAddName(name)
}

func (c *Controller) ProcessDelName(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.ProcessDelName(name)
}

func (c *Controller) ProcessAddPid(pid int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.ProcessAddPid(pid)
}

func (c *Controller) ProcessDelPid(pid int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.ProcessDelPid(pid)
}

func (c *Controller) ProcessCancelAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.ProcessCancelAll()
}

// OpenDrive starts a capture-driver session. Does not UnDrive.
func (c *Controller) OpenDrive(mode int) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return false
	}
	return c.app.OpenDrive(mode)
}

// ReleaseCapture stops process capture and restores system proxy. Never UnDrive.
func (c *Controller) ReleaseCapture() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return
	}
	c.app.ProcessALLName(false, false)
	c.app.ProcessCancelAll()
	c.app.Close()
	_ = c.app.CancelIEProxy()
}

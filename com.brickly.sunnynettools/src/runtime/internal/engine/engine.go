package engine

import "github.com/qtgolang/SunnyNet/SunnyNet"

// Callbacks are SunnyNet event hooks. Implementations must not touch UI windows.
type Callbacks struct {
	HTTP func(SunnyNet.ConnHTTP)
	TCP  func(SunnyNet.ConnTCP)
	WS   func(SunnyNet.ConnWebSocket)
	UDP  func(SunnyNet.ConnUDP)
}

// Engine owns a SunnyNet instance. No AppList / EmitEvent.
type Engine struct {
	sunny *SunnyNet.Sunny
}

func New() *Engine {
	return &Engine{sunny: SunnyNet.NewSunny()}
}

func (e *Engine) Sunny() *SunnyNet.Sunny {
	if e == nil {
		return nil
	}
	return e.sunny
}

func (e *Engine) SetCallbacks(cb Callbacks) {
	if e == nil || e.sunny == nil {
		return
	}
	e.sunny.SetGoCallback(cb.HTTP, cb.TCP, cb.WS, cb.UDP)
}

func (e *Engine) Start() error {
	if e == nil || e.sunny == nil {
		return nil
	}
	e.sunny.Start()
	if e.sunny.Error != nil {
		return e.sunny.Error
	}
	return nil
}

func (e *Engine) Close() {
	if e == nil || e.sunny == nil {
		return
	}
	e.sunny.Close()
}

func (e *Engine) SetPort(port int) {
	if e == nil || e.sunny == nil {
		return
	}
	e.sunny.SetPort(port)
}

func (e *Engine) Port() int {
	if e == nil || e.sunny == nil {
		return 0
	}
	return e.sunny.Port()
}

func (e *Engine) LastError() string {
	if e == nil || e.sunny == nil || e.sunny.Error == nil {
		return ""
	}
	return e.sunny.Error.Error()
}

func (e *Engine) Running() bool {
	return e != nil && e.sunny != nil && e.sunny.Error == nil
}

func (e *Engine) ExportCert() []byte {
	if e == nil || e.sunny == nil {
		return nil
	}
	return e.sunny.ExportCert()
}

func (e *Engine) SetRandomTLS(on bool) {
	if e == nil || e.sunny == nil {
		return
	}
	e.sunny.SetRandomTLS(on)
}

func (e *Engine) DisableTCP(on bool) {
	if e == nil || e.sunny == nil {
		return
	}
	e.sunny.DisableTCP(on)
}

func (e *Engine) DisableUDP(on bool) {
	if e == nil || e.sunny == nil {
		return
	}
	e.sunny.DisableUDP(on)
}

func (e *Engine) Socket5AddUser(user, pass string) {
	if e == nil || e.sunny == nil {
		return
	}
	e.sunny.Socket5AddUser(user, pass)
}

package core

import (
	"changeme/internal/engine"
	"changeme/internal/proxy"
)

// Core is the UI-free façade used by named commands and MCP ops.
type Core struct {
	Engine *engine.Engine
	Proxy  *proxy.Controller
}

func New() *Core {
	eng := engine.New()
	return &Core{
		Engine: eng,
		Proxy:  proxy.New(eng.Sunny()),
	}
}

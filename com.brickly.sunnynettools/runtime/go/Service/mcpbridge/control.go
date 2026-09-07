package mcpbridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"changeme/Service/mcpcatalog"
)

const defaultMCPPort = 6987

// Control 管理本机 MCP Streamable HTTP 服务（唯一路由 /mcp）。
type Control struct {
	mu       sync.Mutex
	host     *Host
	srv      *http.Server
	ln       net.Listener
	addr     string
	lastPort int
}

// NewControl 构造 MCP 控制服务。
func NewControl() *Control {
	return &Control{host: NewHost()}
}

// MCPEnable 在 127.0.0.1:port 启动 MCP Streamable HTTP 服务。
func (c *Control) MCPEnable(port int) string {
	return c.MCPEnableMode(port, "http")
}

// MCPEnableMode 仅支持 http。
func (c *Control) MCPEnableMode(port int, mode string) string {
	_ = mode
	if c == nil || c.host == nil {
		return "MCP 未初始化"
	}
	if port <= 0 || port > 65535 {
		port = defaultMCPPort
	}
	c.mu.Lock()
	if c.addr != "" {
		c.mu.Unlock()
		return "MCP 已在运行"
	}
	c.mu.Unlock()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err.Error()
	}
	mux := http.NewServeMux()
	mux.Handle(MCPStreamablePath, newStreamableMCPHandler(c.host))
	srv := &http.Server{
		Handler:      mux,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 0, // SSE 长连接
	}
	c.mu.Lock()
	c.ln = ln
	c.srv = srv
	c.addr = ln.Addr().String()
	c.lastPort = port
	c.mu.Unlock()
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Print("【MCP】服务异常: ", err)
		}
	}()
	notifyMCPBridgeChanged()
	return ""
}

// MCPDisable 关闭 MCP Streamable HTTP 服务。
func (c *Control) MCPDisable() string {
	return c.MCPDisableTimeout(4 * time.Second)
}

// MCPDisableTimeout 关闭 MCP 服务，超时后直接拆监听。
func (c *Control) MCPDisableTimeout(timeout time.Duration) string {
	if c == nil {
		return ""
	}
	if timeout <= 0 {
		timeout = time.Second
	}
	c.mu.Lock()
	srv := c.srv
	ln := c.ln
	c.srv = nil
	c.ln = nil
	c.addr = ""
	c.mu.Unlock()
	if srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		_ = srv.Shutdown(ctx)
		cancel()
	}
	if ln != nil {
		_ = ln.Close()
	}
	notifyMCPBridgeChanged()
	return ""
}

// MCPStatusJSON 返回 MCP 服务状态 JSON。
func (c *Control) MCPStatusJSON() string {
	if c == nil {
		return `{"enabled":false}`
	}
	c.mu.Lock()
	addr := c.addr
	lp := c.lastPort
	on := addr != ""
	c.mu.Unlock()
	if !on {
		lp = defaultMCPPort
	}
	mcpURL := ""
	if on && addr != "" {
		mcpURL = fmt.Sprintf("http://%s%s", addr, MCPStreamablePath)
	}
	out := map[string]any{
		"enabled":           on,
		"bridgeMode":        "http",
		"httpListenAddr":    addr,
		"defaultPort":       defaultMCPPort,
		"lastPort":          lp,
		"mcpStreamablePath": MCPStreamablePath,
		"mcpStreamableURL":  mcpURL,
	}
	b, _ := json.Marshal(out)
	return string(b)
}

// MCPListOpsJSON 能力目录（含领域/动作元数据）。
func (c *Control) MCPListOpsJSON() string {
	return mcpcatalog.SupportedOpsJSON()
}

// DefaultPort 默认监听端口。
func DefaultPort() int {
	return defaultMCPPort
}

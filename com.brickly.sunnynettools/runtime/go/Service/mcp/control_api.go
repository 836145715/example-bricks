package mcp

import (
	"time"

	"changeme/Service/mcpbridge"
	"changeme/Service/mcpcatalog"
)

// StatusJSON 返回 MCP HTTP 桥状态 JSON。
func StatusJSON() string {
	if mcpControl == nil {
		return `{"enabled":false}`
	}
	return mcpControl.MCPStatusJSON()
}

// Enable 启动 MCP HTTP 桥；成功返回空字符串。
func Enable(port int) string {
	if mcpControl == nil {
		mcpControl = mcpbridge.NewControl()
	}
	return mcpControl.MCPEnable(port)
}

// Disable 关闭 MCP HTTP 桥。
func Disable() string {
	return DisableTimeout(0)
}

// DisableTimeout 关闭 MCP HTTP 桥；timeout<=0 时用默认 4s。
func DisableTimeout(timeout time.Duration) string {
	if mcpControl == nil {
		return ""
	}
	if timeout <= 0 {
		return mcpControl.MCPDisable()
	}
	return mcpControl.MCPDisableTimeout(timeout)
}

// DefaultPort 默认监听端口。
func DefaultPort() int {
	return mcpbridge.DefaultPort()
}

// ListOpsJSON 返回 MCP 桥支持的全部 op 能力目录（JSON）。
func ListOpsJSON() string {
	return mcpcatalog.SupportedOpsJSON()
}

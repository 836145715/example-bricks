package Service

import (
	"fmt"
	"strings"
	"sync"

	"changeme/Service/mcpcatalog"
)

// mcpOpHandler 单个 op 处理器。
type mcpOpHandler func(app *AppMain, args map[string]any) (any, error)

// mcpRegistry op 名 -> 处理器；按能力分域注册（mcpops_<domain>.go 的 init 调用 registerMCPOps）。
var mcpRegistry = map[string]mcpOpHandler{}

// registerMCPOps 注册某领域下的一组 op 处理器。
func registerMCPOps(domain string, ops map[string]mcpOpHandler) {
	for op, h := range ops {
		if _, exists := mcpRegistry[op]; exists {
			panic("mcp: duplicate op handler " + op)
		}
		mcpRegistry[op] = h
	}
}

var mcpRegistryCheckOnce sync.Once

// ensureMCPRegistryConsistency 校验 catalog 与注册表完全一致（无缺失、无多余）。
func ensureMCPRegistryConsistency() {
	mcpRegistryCheckOnce.Do(func() {
		catalog := map[string]bool{}
		for _, op := range mcpcatalog.SupportedBridgeOps {
			catalog[op] = true
		}
		for op := range mcpRegistry {
			if !catalog[op] {
				panic("mcp: handler registered for unknown op " + op)
			}
		}
		for _, op := range mcpcatalog.SupportedBridgeOps {
			if _, ok := mcpRegistry[op]; !ok {
				panic("mcp: missing handler for op " + op)
			}
		}
	})
}

// mcpDomainOf 返回 op 所属领域（基于领域动作注册表）。
func mcpDomainOf(op string) string {
	def, ok := mcpcatalog.ActionByLegacyOp(op)
	if !ok {
		return ""
	}
	return def.Domain
}

// dispatchMCPOp 按 op 分发到领域处理器。
func dispatchMCPOp(app *AppMain, op string, args map[string]any) (any, error) {
	ensureMCPRegistryConsistency()
	h, ok := mcpRegistry[strings.TrimSpace(op)]
	if !ok {
		return nil, fmt.Errorf("未实现的 op: %s（参见 list_supported_ops）", op)
	}
	return h(app, args)
}

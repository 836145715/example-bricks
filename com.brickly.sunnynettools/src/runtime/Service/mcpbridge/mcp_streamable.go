package mcpbridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"changeme/Service/mcpcatalog"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// newStreamableMCPHandler 使用官方 MCP SDK 构建 Streamable HTTP 服务，
// 注册领域网关工具（sunnynet_<domain>），域内 op=list/describe/execute。
func newStreamableMCPHandler(host *Host) http.Handler {
	srv := mcp.NewServer(&mcp.Implementation{Name: "sunnynet", Version: "2.0.0"}, &mcp.ServerOptions{
		Instructions: mcpcatalog.MCPStreamableInstructions,
	})
	for _, tt := range mcpcatalog.GatewayTools() {
		domain := tt.Domain
		tool := &mcp.Tool{
			Name:        tt.MCPName,
			Title:       tt.Title,
			Description: tt.Description,
			InputSchema: mcpcatalog.GatewayInputSchema(),
		}
		mcp.AddTool(srv, tool, func(ctx context.Context, req *mcp.CallToolRequest, in map[string]any) (*mcp.CallToolResult, any, error) {
			return gatewayCall(host, domain, in)
		})
	}
	return mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return srv
	}, &mcp.StreamableHTTPOptions{
		Stateless: true,
	})
}

// gatewayCall 处理领域网关调用：list / describe / execute。
func gatewayCall(host *Host, domain string, in map[string]any) (*mcp.CallToolResult, any, error) {
	if host == nil {
		return nil, nil, errors.New("mcp host nil")
	}
	op := strings.ToLower(strings.TrimSpace(argString(in, "op")))
	switch op {
	case "list":
		def, ok := mcpcatalog.FindDomain(domain)
		if !ok {
			return nil, nil, fmt.Errorf("未知领域: %s", domain)
		}
		actions, _ := mcpcatalog.ActionsForDomain(domain)
		items := make([]map[string]any, 0, len(actions))
		for _, a := range actions {
			items = append(items, map[string]any{
				"action":    a.Action,
				"summary":   a.Summary,
				"useWhen":   a.UseWhen,
				"avoidWhen": a.AvoidWhen,
				"risk":      a.Risk,
			})
		}
		return nil, map[string]any{
			"domain":      def.Name,
			"toolName":    def.ToolName,
			"title":       def.Title,
			"description": def.Description,
			"actions":     items,
		}, nil
	case "describe":
		action := strings.TrimSpace(argString(in, "action"))
		if action == "" {
			return nil, nil, errors.New("describe 必须提供 action")
		}
		def, ok := mcpcatalog.FindAction(domain, action)
		if !ok {
			return nil, nil, fmt.Errorf("action %q 不属于 %s；请先 op=list", action, domain)
		}
		return nil, def, nil
	case "execute":
		action := strings.TrimSpace(argString(in, "action"))
		if action == "" {
			return nil, nil, errors.New("execute 必须提供 action")
		}
		def, ok := mcpcatalog.FindAction(domain, action)
		if !ok {
			return nil, nil, fmt.Errorf("action %q 不属于 %s；请先 op=list", action, domain)
		}
		params := mcpcatalog.NormalizeActionParams(def.LegacyOp, gatewayParams(in))
		if err := mcpcatalog.ValidateActionParams(def.LegacyOp, params); err != nil {
			return nil, nil, err
		}
		raw, err := host.Invoke(def.LegacyOp, params)
		if err != nil {
			return nil, nil, err
		}
		return nil, resultToMap(raw), nil
	default:
		return nil, nil, errors.New("op 必须为 list、describe 或 execute")
	}
}

func gatewayParams(in map[string]any) map[string]any {
	raw, exists := in["params"]
	if !exists || raw == nil {
		return map[string]any{}
	}
	params, ok := raw.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return params
}

// resultToMap 将 host.Invoke 返回值规整为 MCP 工具 result（与旧 /invoke 的 result 字段一致）。
func resultToMap(raw any) map[string]any {
	switch v := raw.(type) {
	case map[string]any:
		return v
	case json.RawMessage:
		var out map[string]any
		if len(v) > 0 && json.Unmarshal(v, &out) == nil && out != nil {
			return out
		}
		var arr []any
		if len(v) > 0 && json.Unmarshal(v, &arr) == nil {
			return map[string]any{"data": arr}
		}
	case string:
		s := strings.TrimSpace(v)
		if s != "" {
			var out map[string]any
			if json.Unmarshal([]byte(s), &out) == nil && out != nil {
				return out
			}
			var arr []any
			if json.Unmarshal([]byte(s), &arr) == nil {
				return map[string]any{"data": arr}
			}
			return map[string]any{"text": v}
		}
	default:
		raw2, _ := json.Marshal(v)
		var out map[string]any
		if len(raw2) > 0 && json.Unmarshal(raw2, &out) == nil && out != nil {
			return out
		}
	}
	return map[string]any{}
}

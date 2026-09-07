package mcpcatalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

// RiskLevel 动作风险级别（供网关 list/describe 展示，不改变执行语义）。
type RiskLevel string

const (
	RiskRead        RiskLevel = "read"
	RiskWrite       RiskLevel = "write"
	RiskDestructive RiskLevel = "destructive"
)

// ActionDefinition 领域下某个动作的完整定义（网关 describe 返回；legacyOp 为旧扁平 op 名）。
type ActionDefinition struct {
	Domain      string    `json:"domain"`
	Action      string    `json:"action"`
	Summary     string    `json:"summary"`
	UseWhen     string    `json:"useWhen"`
	AvoidWhen   string    `json:"avoidWhen"`
	Returns     string    `json:"returns"`
	Risk        RiskLevel `json:"risk"`
	InputSchema any       `json:"inputSchema"`
	LegacyOp    string    `json:"-"`
}

// DomainDefinition 领域定义（网关 list 返回）。
type DomainDefinition struct {
	Name        string `json:"name"`
	ToolName    string `json:"toolName"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type actionMapping struct {
	domain   string
	action   string
	legacyOp string
	risk     RiskLevel
}

// domainDefinitions 领域集合（按作用分类）。toolName 即网关工具名（sunnynet_<name>）。
var domainDefinitions = []DomainDefinition{
	{Name: "system", ToolName: "sunnynet_system", Title: "抓包工具与系统", Description: "抓包工具、运行状态、系统代理、捕获区与界面主题。"},
	{Name: "traffic", ToolName: "sunnynet_traffic", Title: "流量主列表", Description: "主列表分页、搜索、单元格、标记、注释与删除。"},
	{Name: "content", ToolName: "sunnynet_content", Title: "正文与流消息", Description: "HTTP Body、流消息、局部读取、分块读取与 Protobuf 转换。"},
	{Name: "session", ToolName: "sunnynet_session", Title: "会话管理", Description: "会话结构、导入导出、行映射与内置请求代码生成。"},
	{Name: "breakpoint", ToolName: "sunnynet_breakpoint", Title: "断点与重放", Description: "HTTP 断点、放行、跳转、同步改包与重放。"},
	{Name: "rules", ToolName: "sunnynet_rules", Title: "规则管理", Description: "替换、重写、拦截、屏蔽与 Host 规则。"},
	{Name: "config", ToolName: "sunnynet_config", Title: "抓包工具设置", Description: "上游代理、DNS、强制 TCP、开关、HTTPS/JA3/HTTP2 与请求证书。"},
	{Name: "device", ToolName: "sunnynet_device", Title: "设备与进程捕获", Description: "Windows 捕获驱动与进程捕获目标。"},
}

// actionMappings 领域-动作-旧扁平 op 映射；与 bridgeOpCatalog 一一对应。
var actionMappings = []actionMapping{
	{domain: "system", action: "runtime.ping", legacyOp: "ping", risk: RiskRead},
	{domain: "system", action: "runtime.supportedOps", legacyOp: "list_supported_ops", risk: RiskRead},
	{domain: "system", action: "runtime.status", legacyOp: "get_status", risk: RiskRead},
	{domain: "system", action: "engine.start", legacyOp: "engine_start", risk: RiskWrite},
	{domain: "system", action: "engine.stop", legacyOp: "engine_stop", risk: RiskWrite},
	{domain: "system", action: "engine.applyAdvanced", legacyOp: "engine_apply_advanced", risk: RiskWrite},
	{domain: "system", action: "engine.reapply", legacyOp: "config_reapply_engine", risk: RiskWrite},
	{domain: "system", action: "capture.hide", legacyOp: "capture_hide", risk: RiskWrite},
	{domain: "system", action: "capture.show", legacyOp: "capture_show", risk: RiskWrite},
	{domain: "system", action: "proxy.enable", legacyOp: "system_proxy_enable", risk: RiskWrite},
	{domain: "system", action: "proxy.disable", legacyOp: "system_proxy_disable", risk: RiskWrite},
	{domain: "system", action: "theme.get", legacyOp: "ui_theme_get", risk: RiskRead},
	{domain: "system", action: "theme.set", legacyOp: "ui_theme_set", risk: RiskWrite},

	{domain: "traffic", action: "list.count", legacyOp: "main_count", risk: RiskRead},
	{domain: "traffic", action: "list.slice", legacyOp: "main_slice", risk: RiskRead},
	{domain: "traffic", action: "list.cells", legacyOp: "main_cells", risk: RiskRead},
	{domain: "traffic", action: "list.search", legacyOp: "main_search", risk: RiskRead},
	{domain: "traffic", action: "list.breakGet", legacyOp: "main_row_break_get", risk: RiskRead},
	{domain: "traffic", action: "note.get", legacyOp: "main_row_note_get", risk: RiskRead},
	{domain: "traffic", action: "note.set", legacyOp: "main_row_note_set", risk: RiskWrite},
	{domain: "traffic", action: "list.mark", legacyOp: "main_apply_row_mark", risk: RiskWrite},
	{domain: "traffic", action: "list.clear", legacyOp: "main_clear", risk: RiskDestructive},
	{domain: "traffic", action: "list.delete", legacyOp: "main_delete", risk: RiskDestructive},
	{domain: "traffic", action: "list.deleteExcept", legacyOp: "main_delete_except", risk: RiskDestructive},

	{domain: "content", action: "stream.count", legacyOp: "stream_count", risk: RiskRead},
	{domain: "content", action: "stream.slice", legacyOp: "stream_slice", risk: RiskRead},
	{domain: "content", action: "http.part", legacyOp: "http_get_part", risk: RiskRead},
	{domain: "content", action: "stream.part", legacyOp: "stream_get_part", risk: RiskRead},
	{domain: "content", action: "stream.hex", legacyOp: "stream_get_hex", risk: RiskRead},
	{domain: "content", action: "stream.send", legacyOp: "stream_send", risk: RiskWrite},
	{domain: "content", action: "protobuf.toJson", legacyOp: "pb_to_json", risk: RiskRead},

	{domain: "session", action: "row.theology", legacyOp: "row_theology", risk: RiskRead},
	{domain: "session", action: "session.get", legacyOp: "session_get_json", risk: RiskRead},
	{domain: "session", action: "session.packExport", legacyOp: "session_pack_export", risk: RiskWrite},
	{domain: "session", action: "session.import", legacyOp: "records_import", risk: RiskWrite},
	{domain: "session", action: "session.export", legacyOp: "records_export", risk: RiskDestructive},
	{domain: "session", action: "code.generateBuiltin", legacyOp: "generate_builtin_code", risk: RiskWrite},

	{domain: "breakpoint", action: "break.continue", legacyOp: "break_continue", risk: RiskWrite},
	{domain: "breakpoint", action: "break.continueAll", legacyOp: "break_continue_all", risk: RiskWrite},
	{domain: "breakpoint", action: "break.skipToResponse", legacyOp: "break_skip_to_response", risk: RiskWrite},
	{domain: "breakpoint", action: "break.syncRequest", legacyOp: "break_sync_request", risk: RiskWrite},
	{domain: "breakpoint", action: "break.syncResponse", legacyOp: "break_sync_response", risk: RiskWrite},
	{domain: "breakpoint", action: "http.replay", legacyOp: "http_replay", risk: RiskWrite},

	{domain: "rules", action: "replace.get", legacyOp: "config_get_replace", risk: RiskRead},
	{domain: "rules", action: "replace.set", legacyOp: "config_set_replace", risk: RiskDestructive},
	{domain: "rules", action: "rewrite.get", legacyOp: "config_get_rewrite", risk: RiskRead},
	{domain: "rules", action: "rewrite.set", legacyOp: "config_set_rewrite", risk: RiskDestructive},
	{domain: "rules", action: "intercept.get", legacyOp: "config_get_intercept", risk: RiskRead},
	{domain: "rules", action: "intercept.set", legacyOp: "config_set_intercept", risk: RiskDestructive},
	{domain: "rules", action: "rule.setState", legacyOp: "config_rule_set_state", risk: RiskWrite},
	{domain: "rules", action: "block.get", legacyOp: "config_get_block", risk: RiskRead},
	{domain: "rules", action: "block.set", legacyOp: "config_set_block", risk: RiskDestructive},
	{domain: "rules", action: "host.get", legacyOp: "config_get_host", risk: RiskRead},
	{domain: "rules", action: "host.set", legacyOp: "config_set_host", risk: RiskDestructive},
	{domain: "rules", action: "host.add", legacyOp: "config_host_add", risk: RiskWrite},
	{domain: "rules", action: "host.delete", legacyOp: "config_host_delete", risk: RiskDestructive},
	{domain: "rules", action: "host.update", legacyOp: "config_host_update", risk: RiskWrite},

	{domain: "config", action: "proxyDns.get", legacyOp: "config_get_proxy_dns", risk: RiskRead},
	{domain: "config", action: "proxyDns.set", legacyOp: "config_set_proxy_dns", risk: RiskWrite},
	{domain: "config", action: "proxyWay.get", legacyOp: "config_get_proxy_way", risk: RiskRead},
	{domain: "config", action: "proxyWay.add", legacyOp: "config_proxy_way_add", risk: RiskWrite},
	{domain: "config", action: "proxyWay.update", legacyOp: "config_proxy_way_update", risk: RiskWrite},
	{domain: "config", action: "proxyWay.updateNote", legacyOp: "config_proxy_way_update_note", risk: RiskWrite},
	{domain: "config", action: "proxyWay.delete", legacyOp: "config_proxy_way_delete", risk: RiskDestructive},
	{domain: "config", action: "proxyWay.setState", legacyOp: "config_proxy_way_set_state", risk: RiskWrite},
	{domain: "config", action: "proxyRoles.get", legacyOp: "config_get_proxy_roles", risk: RiskRead},
	{domain: "config", action: "proxyRoles.set", legacyOp: "config_set_proxy_roles", risk: RiskWrite},
	{domain: "config", action: "mustTcp.get", legacyOp: "config_get_must_tcp", risk: RiskRead},
	{domain: "config", action: "mustTcp.set", legacyOp: "config_set_must_tcp", risk: RiskWrite},
	{domain: "config", action: "toggles.get", legacyOp: "config_get_engine_toggles", risk: RiskRead},
	{domain: "config", action: "toggles.getDisableTCP", legacyOp: "config_get_disable_tcp", risk: RiskRead},
	{domain: "config", action: "toggles.getDisableUDP", legacyOp: "config_get_disable_udp", risk: RiskRead},
	{domain: "config", action: "toggles.getDisableCache", legacyOp: "config_get_disable_cache", risk: RiskRead},
	{domain: "config", action: "toggles.setDisableTCP", legacyOp: "config_set_disable_tcp", risk: RiskWrite},
	{domain: "config", action: "toggles.setDisableUDP", legacyOp: "config_set_disable_udp", risk: RiskWrite},
	{domain: "config", action: "toggles.setDisableCache", legacyOp: "config_set_disable_cache", risk: RiskWrite},
	{domain: "config", action: "limit.get", legacyOp: "config_get_limit_request_size", risk: RiskRead},
	{domain: "config", action: "limit.set", legacyOp: "config_set_limit_request_size", risk: RiskWrite},
	{domain: "config", action: "https.get", legacyOp: "config_get_https_protocol", risk: RiskRead},
	{domain: "config", action: "https.set", legacyOp: "config_set_https_protocol", risk: RiskWrite},
	{domain: "config", action: "https.getRandomJa3", legacyOp: "config_get_random_ja3", risk: RiskRead},
	{domain: "config", action: "https.setRandomJa3", legacyOp: "config_set_random_ja3", risk: RiskWrite},
	{domain: "config", action: "https.getHttp2Fingerprint", legacyOp: "config_get_http2_fingerprint", risk: RiskRead},
	{domain: "config", action: "https.setHttp2Fingerprint", legacyOp: "config_set_http2_fingerprint", risk: RiskWrite},
	{domain: "config", action: "https.applyHttp2Template", legacyOp: "config_apply_http2_template", risk: RiskWrite},
	{domain: "config", action: "https.listHttp2Templates", legacyOp: "config_list_http2_templates", risk: RiskRead},
	{domain: "config", action: "https.getHttp2Template", legacyOp: "config_get_http2_template", risk: RiskRead},
	{domain: "config", action: "cert.list", legacyOp: "request_cert_list", risk: RiskRead},
	{domain: "config", action: "cert.add", legacyOp: "request_cert_add", risk: RiskWrite},
	{domain: "config", action: "cert.delete", legacyOp: "request_cert_delete", risk: RiskDestructive},
	{domain: "config", action: "cert.update", legacyOp: "request_cert_update", risk: RiskWrite},

	{domain: "device", action: "status", legacyOp: "device_status", risk: RiskRead},
	{domain: "device", action: "load", legacyOp: "device_load", risk: RiskWrite},
	{domain: "device", action: "process.addName", legacyOp: "device_process_add_name", risk: RiskWrite},
	{domain: "device", action: "process.removeName", legacyOp: "device_process_del_name", risk: RiskWrite},
	{domain: "device", action: "process.addPid", legacyOp: "device_process_add_pid", risk: RiskWrite},
	{domain: "device", action: "process.removePid", legacyOp: "device_process_del_pid", risk: RiskWrite},
	{domain: "device", action: "process.clear", legacyOp: "device_process_cancel_all", risk: RiskWrite},
}

var (
	actionRegistry      map[string]ActionDefinition
	actionsByDomain     map[string][]ActionDefinition
	actionValidators    map[string]*jsonschema.Resolved
	actionByLegacyOp    map[string]ActionDefinition
	actionRegistryReady bool
)

func loadActionRegistry() {
	capabilities := make(map[string]BridgeOpCapability, len(bridgeOpCatalog))
	for _, c := range bridgeOpCatalog {
		capabilities[c.Op] = c
	}
	actionRegistry = make(map[string]ActionDefinition, len(actionMappings))
	actionsByDomain = make(map[string][]ActionDefinition, len(domainDefinitions))
	actionValidators = make(map[string]*jsonschema.Resolved, len(actionMappings))
	actionByLegacyOp = make(map[string]ActionDefinition, len(actionMappings))
	for _, m := range actionMappings {
		cap, ok := capabilities[m.legacyOp]
		if !ok {
			panic("mcpcatalog: missing capability metadata for " + m.legacyOp)
		}
		inputSchema := canonicalActionSchema(m.legacyOp)
		validator, err := compileActionSchema(inputSchema)
		if err != nil {
			panic("mcpcatalog: invalid input schema for " + m.legacyOp + ": " + err.Error())
		}
		definition := ActionDefinition{
			Domain:      m.domain,
			Action:      m.action,
			Summary:     shortActionSummary(cap.Description),
			UseWhen:     strings.TrimSpace(cap.Description),
			AvoidWhen:   actionAvoidWhen(m.legacyOp),
			Returns:     strings.TrimSpace(cap.Returns),
			Risk:        m.risk,
			InputSchema: inputSchema,
			LegacyOp:    m.legacyOp,
		}
		key := actionKey(m.domain, m.action)
		if _, exists := actionRegistry[key]; exists {
			panic("mcpcatalog: duplicate action " + key)
		}
		actionRegistry[key] = definition
		actionValidators[key] = validator
		actionByLegacyOp[m.legacyOp] = definition
		actionsByDomain[m.domain] = append(actionsByDomain[m.domain], definition)
	}
	actionRegistryReady = true
}

func ensureActionRegistry() {
	if !actionRegistryReady {
		loadActionRegistry()
	}
}

func actionKey(domain, action string) string {
	return strings.ToLower(strings.TrimSpace(domain)) + "\x00" + strings.ToLower(strings.TrimSpace(action))
}

// DomainDefinitions 返回全部领域定义（顺序与定义一致）。
func DomainDefinitions() []DomainDefinition {
	return append([]DomainDefinition(nil), domainDefinitions...)
}

// ActionDefinitions 返回全部动作定义（按领域分组顺序）。
func ActionDefinitions() []ActionDefinition {
	ensureActionRegistry()
	out := make([]ActionDefinition, 0, len(actionMappings))
	for _, d := range domainDefinitions {
		out = append(out, actionsByDomain[d.Name]...)
	}
	return out
}

// FindDomain 按名称查找领域定义。
func FindDomain(domain string) (DomainDefinition, bool) {
	wanted := strings.ToLower(strings.TrimSpace(domain))
	for _, d := range domainDefinitions {
		if d.Name == wanted {
			return d, true
		}
	}
	return DomainDefinition{}, false
}

// ActionsForDomain 返回指定领域的动作列表。
func ActionsForDomain(domain string) ([]ActionDefinition, bool) {
	ensureActionRegistry()
	actions, ok := actionsByDomain[strings.ToLower(strings.TrimSpace(domain))]
	if !ok {
		return nil, false
	}
	return append([]ActionDefinition(nil), actions...), true
}

// FindAction 查找领域下的动作。
func FindAction(domain, action string) (ActionDefinition, bool) {
	ensureActionRegistry()
	definition, ok := actionRegistry[actionKey(domain, action)]
	return definition, ok
}

// ActionByLegacyOp 按旧扁平 op 名查找动作定义。
func ActionByLegacyOp(legacyOp string) (ActionDefinition, bool) {
	ensureActionRegistry()
	definition, ok := actionByLegacyOp[strings.ToLower(strings.TrimSpace(legacyOp))]
	return definition, ok
}

// ActionsJSON 返回领域+动作元数据 JSON（供网关 /supported-ops 扩展与客户端发现）。
func ActionsJSON() string {
	ensureActionRegistry()
	payload := map[string]any{
		"version": 2,
		"domains": DomainDefinitions(),
		"actions": ActionDefinitions(),
	}
	b, _ := json.Marshal(payload)
	return string(b)
}

// GatewayToolName 领域网关工具名。
func GatewayToolName(domain string) string {
	return "sunnynet_" + strings.ToLower(strings.TrimSpace(domain))
}

// GatewayInputSchema 领域网关工具入参 schema（op= list/describe/execute + action + params）。
func GatewayInputSchema() any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"op": map[string]any{
				"type":        "string",
				"enum":        []string{"list", "describe", "execute"},
				"description": "list 列出本领域动作；describe 查看一个动作的精确参数；execute 执行一个动作。",
			},
			"action": map[string]any{
				"type":        "string",
				"description": "点分层级动作名；describe 和 execute 必填。",
			},
			"params": map[string]any{
				"type":                 "object",
				"description":          "execute 的动作参数；字段必须来自 describe 返回的 inputSchema。",
				"additionalProperties": true,
			},
		},
		"required": []string{"op"},
	}
}

// GatewayTools 返回全部领域网关工具（供 Streamable 注册；execute 时调用 host.Invoke(legacyOp, params)）。
func GatewayTools() []BridgeMCPTool {
	out := make([]BridgeMCPTool, 0, len(domainDefinitions))
	for _, d := range domainDefinitions {
		actions, _ := ActionsForDomain(d.Name)
		out = append(out, BridgeMCPTool{
			MCPName:     d.ToolName,
			Domain:      d.Name,
			Op:          "",
			Title:       d.Title,
			Description: d.Title + "：" + d.Description + " 域内使用 op=list / describe / execute 调用。",
		})
		_ = actions
	}
	return out
}

func shortActionSummary(description string) string {
	text := strings.TrimSpace(description)
	if index := strings.Index(text, "【场景】"); index >= 0 {
		rest := text[index+len("【场景】"):]
		if end := strings.Index(rest, "。"); end >= 0 {
			return strings.TrimSpace(rest[:end+1])
		}
		if end := strings.Index(rest, "；"); end >= 0 {
			return strings.TrimSpace(rest[:end+1])
		}
		return strings.TrimSpace(rest)
	}
	return text
}

func actionAvoidWhen(legacyOp string) string {
	switch legacyOp {
	case "main_slice":
		return "仅需数量时使用 list.count；按条件定位时使用 list.search。"
	case "main_search":
		return "不要用于修改 UI 筛选或删除数据。"
	case "http_get_part", "stream_get_part", "stream_get_hex":
		return "不要用于行数、长度、查找或单行读取；这些场景使用 list.slice / stream.slice。"
	case "main_clear", "main_delete", "main_delete_except":
		return "用户未明确要求删除或清空时不要调用。"
	case "config_set_replace", "config_set_rewrite", "config_set_intercept", "config_set_block", "config_set_host":
		return "未先读取并构造完整规则集合时不要调用；该动作会全量覆盖。"
	case "records_export", "session_pack_export":
		return "用户未明确指定导出路径时不要调用；目标路径已存在时可能被覆盖。"
	default:
		return "请求不属于该动作说明时不要调用；不确定参数先 describe。"
	}
}

func canonicalActionSchema(legacyOp string) any {
	schema := ToolInputSchema(legacyOp)
	if schema == nil {
		return map[string]any{"type": "object", "additionalProperties": false}
	}
	encoded, err := json.Marshal(schema)
	if err != nil {
		return schema
	}
	var normalized any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return schema
	}
	canonicalizeSchemaValue(legacyOp, normalized)
	applyActionSchemaConstraints(legacyOp, normalized)
	return normalized
}

func compileActionSchema(value any) (*jsonschema.Resolved, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var schema jsonschema.Schema
	if err := json.Unmarshal(encoded, &schema); err != nil {
		return nil, err
	}
	return schema.Resolve(nil)
}

func actionSchemaProperties(value any) map[string]bool {
	out := map[string]bool{}
	root, _ := value.(map[string]any)
	properties, _ := root["properties"].(map[string]any)
	for name := range properties {
		out[name] = true
	}
	return out
}

func applyActionSchemaConstraints(legacyOp string, value any) {
	root, _ := value.(map[string]any)
	properties, _ := root["properties"].(map[string]any)
	property := func(name string) map[string]any {
		item, _ := properties[name].(map[string]any)
		return item
	}
	setEnum := func(name string, values ...any) {
		if item := property(name); item != nil {
			item["enum"] = values
		}
	}
	setRange := func(name string, minimum, maximum float64) {
		if item := property(name); item != nil {
			item["minimum"] = minimum
			item["maximum"] = maximum
		}
	}
	setMinimum := func(name string, minimum float64) {
		if item := property(name); item != nil {
			item["minimum"] = minimum
		}
	}

	switch legacyOp {
	case "http_replay":
		setRange("interceptMode", 0, 2)
		setRange("repeatCount", 1, 100)
	case "engine_start":
		setRange("port", 1, 65535)
	case "break_sync_response":
		setRange("statusCode", 100, 599)
	case "main_slice", "stream_slice":
		setMinimum("offset", 0)
		setRange("limit", 1, 10000)
	case "http_get_part":
		setEnum("part", "requestBody", "responseBody", "rawRequest", "rawResponse")
		setEnum("type", "auto", "hex", "base64", "str")
		setMinimum("offset", 0)
		setRange("maxLen", 0, 4*1024*1024)
	case "stream_get_part":
		setEnum("type", "auto", "hex", "base64", "str")
		setMinimum("messageId", 1)
		setMinimum("offset", 0)
		setRange("maxLen", 0, 4*1024*1024)
	case "device_load":
		setEnum("mode", 0, 1, 2)
	case "ui_theme_set":
		setEnum("mode", "dark", "light", "toggle")
	case "pb_to_json":
		setMinimum("skipFirstBytes", 0)
	case "main_delete_except":
		setEnum("keepIds", "keepRowIds")
	}
	for _, name := range []string{"messageId", "pid"} {
		setMinimum(name, 1)
	}
	for _, name := range []string{"offset", "skipFirstBytes"} {
		setMinimum(name, 0)
	}
	setEnum("outType", "auto", "hex", "base64", "str")
}

func canonicalizeSchemaValue(legacyOp string, value any) {
	switch typed := value.(type) {
	case map[string]any:
		if properties, ok := typed["properties"].(map[string]any); ok {
			renameSchemaProperty(properties, "MessageID", "messageId")
			renameSchemaProperty(properties, "OutType", "outType")
			renameSchemaProperty(properties, "Count", "count")
			renameSchemaProperty(properties, "Offset", "offset")
			delete(properties, "ids")
			if legacyOp == "main_delete_except" {
				renameSchemaProperty(properties, "keepIds", "keepRowIds")
				delete(properties, "rowIds")
			}
		}
		if required, ok := typed["required"].([]any); ok {
			for index, item := range required {
				name, _ := item.(string)
				switch name {
				case "MessageID":
					required[index] = "messageId"
				case "OutType":
					required[index] = "outType"
				case "Count":
					required[index] = "count"
				case "Offset":
					required[index] = "offset"
				case "ids":
					required[index] = "rowIds"
				case "keepIds":
					required[index] = "keepRowIds"
				}
			}
		}
		for _, child := range typed {
			canonicalizeSchemaValue(legacyOp, child)
		}
	case []any:
		for _, child := range typed {
			canonicalizeSchemaValue(legacyOp, child)
		}
	}
}

func renameSchemaProperty(properties map[string]any, from, to string) {
	if value, exists := properties[from]; exists {
		if _, canonicalExists := properties[to]; !canonicalExists {
			properties[to] = value
		}
		delete(properties, from)
	}
}

// NormalizeActionParams 将别名参数归一化为 schema 标准字段（不影响既有 flat op 路径）。
func NormalizeActionParams(legacyOp string, params map[string]any) map[string]any {
	out := make(map[string]any, len(params)+2)
	for key, value := range params {
		out[key] = value
	}
	copyAlias := func(canonical string, aliases ...string) {
		if _, exists := out[canonical]; exists {
			return
		}
		for _, alias := range aliases {
			if value, exists := out[alias]; exists {
				out[canonical] = value
				return
			}
		}
	}
	properties := actionSchemaProperties(canonicalActionSchema(legacyOp))
	if properties["messageId"] {
		copyAlias("messageId", "MessageID", "messageID")
	}
	if properties["outType"] {
		copyAlias("outType", "OutType")
		if !properties["type"] {
			copyAlias("outType", "type")
		}
	}
	if properties["type"] {
		copyAlias("type", "OutType", "outType")
	}
	if properties["count"] {
		copyAlias("count", "Count")
	}
	if properties["offset"] {
		copyAlias("offset", "Offset")
	}
	if properties["rowIds"] {
		copyAlias("rowIds", "ids")
		if _, exists := out["rowIds"]; !exists {
			if rowID := argString(out, "rowId"); rowID != "" {
				out["rowIds"] = []string{rowID}
			}
		}
	}
	if properties["theologies"] && !properties["theology"] {
		if _, exists := out["theologies"]; !exists {
			if value, exists := out["theology"]; exists {
				out["theologies"] = []any{value}
			}
		}
	}
	if properties["id"] && !properties["rowId"] {
		copyAlias("id", "rowId")
	}
	if properties["keepIds"] {
		copyAlias("keepIds", "keepRowIds", "rowIds", "ids")
	}
	for _, alias := range []string{"MessageID", "messageID", "OutType", "Count", "Offset", "ids", "keepIds", "rowId", "theology", "rowIds", "type", "outType"} {
		if !properties[alias] {
			delete(out, alias)
		}
	}
	return out
}

// ValidateActionParams 对动作参数做基本类型/必填校验（与 flat op 内部校验互补）。
func ValidateActionParams(legacyOp string, params map[string]any) error {
	for _, key := range []string{"port", "mode", "statusCode", "repeatCount", "offset", "maxLen", "messageId", "count", "pid", "skipFirstBytes", "limit"} {
		if value, exists := params[key]; exists && !isIntegerValue(value) {
			return fmt.Errorf("%s 必须为整数", key)
		}
	}
	for _, key := range []string{"useSystemProxy", "manual", "includeHidden", "replaceAll", "randomJa3", "caseInsensitive", "stripSpaces"} {
		if value, exists := params[key]; exists {
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("%s 必须为布尔值", key)
			}
		}
	}
	if schema := canonicalActionSchema(legacyOp); schema != nil {
		if validator, err := compileActionSchema(schema); err == nil {
			if err := validator.Validate(params); err != nil {
				return fmt.Errorf("%s 参数不符合 inputSchema: %w；不确定参数请先 describe", legacyOp, err)
			}
		}
	}
	return nil
}

func isIntegerValue(value any) bool {
	switch typed := value.(type) {
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, json.Number:
		return true
	case float64:
		return typed == float64(int64(typed))
	case float32:
		return typed == float32(int64(typed))
	default:
		return false
	}
}

func argString(m map[string]any, k string) string {
	v, ok := m[k]
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}

var _ = errors.New

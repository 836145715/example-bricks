package main

import (
	"encoding/json"
	"fmt"
	"reflect"

	brickly "github.com/836145715/brickly-sdk-go"
)

// publicCommandTable 是工作台 / 其它 Brick / MCP 可调用的公开命令。
// UI 私有方法只走 control-stream 的 session.request，不再注册为 OnCommand。
var publicCommandTable = map[string]string{
	// ---- 代理 / 抓包 ----
	"start-capture":      "Start",
	"stop-capture":       "Shutdown",
	"capture-status":     "AppCheckSunnyNet",
	"capture-error":      "GetError",
	"capture-version":    "AppVersion",
	"get-port":           "GetPort",
	"set-port":           "SetPort",
	"is-port-set":        "AppIsSetPort",
	"set-system-proxy":   "SetIEProxy",
	"clear-system-proxy": "CancelIEProxy",
	"set-working":        "SetWorking",
	"goos":               "GOOS",

	// ---- 会话 ----
	"get-session":              "GetHTTPSession",
	"get-request-body":         "GetHTTPRequestBody",
	"get-response-body":        "GetHTTPResponseBody",
	"get-session-message-body": "GetSessionMessageBody",
	"get-all-stream":           "GetAllStream",
	"delete-sessions":          "AppDeleteSession",
	"clear-sessions":           "ClearAllSession",
	"find-sessions":            "FindSession",
	"export-sessions":          "AppExport",
	"import-sessions":          "AppImport",
	"resend-request":           "AppResendRequest",
	"update-note":              "UpdateNote",
	"active-send":              "SessionActiveSend",
	"disconnect-tcp":           "AppDisconnectTCPRequest",

	// ---- 断点改包 ----
	"set-break-mode":              "SetBreakMode",
	"set-request-next-break-mode": "SetRequestNextBreakMode",
	"update-http-request":         "UpdateHttpRequest",
	"update-http-response":        "UpdateHttpResponse",

	// ---- 证书 / 进程 ----
	"export-cert":            "ExportCert",
	"list-processes":         "GetAllProcessesList",
	"process-add-name":       "ProcessAddName",
	"process-del-name":       "ProcessDelName",
	"process-add-pid":        "ProcessAddPid",
	"process-del-pid":        "ProcessDelPid",
	"process-any":            "ProcessAny",
	"load-device":            "LoadDevice",
	"set-device-stop-update": "SetDeviceStopUpdate",

	// ---- MCP ----
	"mcp-status":   "MCPStatusJSON",
	"mcp-list-ops": "MCPListOpsJSON",
	"mcp-enable":   "MCPEnable",
	"mcp-disable":  "MCPDisable",
}

// verifyCommandTable 启动时校验表里的方法都存在，避免笔误静默失败。
func verifyCommandTable() []string {
	var missing []string
	if Server == nil {
		return []string{"server not initialized"}
	}
	v := reflect.ValueOf(Server)
	for id, method := range publicCommandTable {
		if !v.MethodByName(method).IsValid() {
			missing = append(missing, fmt.Sprintf("%s -> %s", id, method))
		}
	}
	return missing
}

// registerCommands 把公开命令表注册为平台命令；handler 使用 CommandContext 做取消。
func registerCommands() {
	for id, method := range publicCommandTable {
		id, method := id, method
		plugin.OnCommand(id, func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
			if err := ctx.Context().Err(); err != nil {
				return nil, err
			}
			return callNamed(method, input)
		})
	}
}

// callNamed 按方法名调用，input 为 {"args":[...]}；兼容直接传数组。
func callNamed(method string, input json.RawMessage) (any, error) {
	var wrapper struct {
		Args []json.RawMessage `json:"args"`
	}
	if len(input) > 0 && input[0] == '[' {
		if err := json.Unmarshal(input, &wrapper.Args); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
	} else if err := json.Unmarshal(input, &wrapper); err != nil {
		return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
	}
	return invokeWithArgs(method, wrapper.Args)
}

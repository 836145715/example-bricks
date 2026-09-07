/**
 * Generates uicommands.go + frontend/src/brickly/api.js from a command table.
 * Run: node scripts/gen-ui-commands.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const brick = path.resolve(here, "..");

/**
 * @typedef {{
 *   id: string,
 *   js: string,
 *   args?: string[],
 *   go: string,
 *   ret?: "value"|"ok"|"tuple5"|"path",
 * }} Cmd
 */

/** @type {Cmd[]} */
const cmds = [
  { id: "is-dark", js: "IsDark", go: "return Server.IsDark(), nil", ret: "value" },
  { id: "set-is-dark", js: "SetIsDark", args: ["isDark"], go: `Server.SetIsDark(req.IsDark)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "theme", js: "Theme", args: ["isDark", "type", "theme"], go: "return Server.Theme(req.IsDark, req.Type, req.Theme), nil", ret: "value" },
  { id: "app-get-theme", js: "AppGetTheme", args: ["isDark"], go: `Server.AppGetTheme(req.IsDark)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-ag-grid-light-theme", js: "GetAgGridLightTheme", go: "return Server.GetAgGridLightTheme(), nil", ret: "value" },
  { id: "get-ag-grid-dark-theme", js: "GetAgGridDarkTheme", go: "return Server.GetAgGridDarkTheme(), nil", ret: "value" },
  { id: "get-list-color", js: "GetListColor", args: ["isDark"], go: "return Server.GetListColor(req.IsDark), nil", ret: "value" },
  { id: "set-list-color", js: "SetListColor", args: ["isDark", "colorId", "color"], go: `Server.SetListColor(req.IsDark, req.ColorID, req.Color)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "default-color", js: "DefaultColor", args: ["isDark"], go: `Server.DefaultColor(req.IsDark)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-home-text-mark", js: "GetHomeTextMark", go: "return Server.GetHomeTextMark(), nil", ret: "value" },
  { id: "set-home-text-mark", js: "SetHomeTextMark", args: ["textMark"], go: `Server.SetHomeTextMark(req.TextMark)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-keys", js: "GetKeys", go: "return Server.GetKeys(), nil", ret: "value" },
  { id: "set-keys", js: "SetKeys", args: ["obj"], go: `Server.SetKeys(req.Obj)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "call-keys", js: "CallKeys", args: ["id"], go: `Server.CallKeys(req.ID)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "set-is-edit-key-down", js: "SetIsEditKeyDown", args: ["value"], go: `Server.SetIsEditKeyDown(req.Value)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-column-state", js: "GetColumnState", go: "return Server.GetColumnState(), nil", ret: "value" },
  { id: "set-column-state", js: "SetColumnState", args: ["columnState"], go: `Server.SetColumnState(req.ColumnState)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-base-settings-value", js: "GetBaseSettingsValue", go: `a, b, c, d, e := Server.GetBaseSettingsValue()\n\t\treturn []any{a, b, c, d, e}, nil`, ret: "tuple5" },
  { id: "set-disable-tcp", js: "SetDisableTCP", args: ["disable"], go: `Server.SetDisableTCP(req.Disable)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "set-disable-udp", js: "SetDisableUDP", args: ["disable"], go: `Server.SetDisableUDP(req.Disable)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "set-disable-cache", js: "SetDisableCache", args: ["disable"], go: `Server.SetDisableCache(req.Disable)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "set-limit-request-size", js: "SetLimitRequestSize", args: ["size"], go: `Server.SetLimitRequestSize(req.Size)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "set-auth-mode", js: "SetAuthMode", args: ["open"], go: `Server.SetAuthMode(req.Open)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "auth-mode-create", js: "AuthModeCreate", go: "return Server.AuthModeCreate(), nil", ret: "value" },
  { id: "auth-mode-list", js: "AuthModeList", go: "return Server.AuthModeList(), nil", ret: "value" },
  { id: "auth-mode-set", js: "AuthModeSet", args: ["id", "user", "pass"], go: `Server.AuthModeSet(req.ID, req.User, req.Pass)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "auth-mode-remove", js: "AuthModeRemove", args: ["id"], go: `Server.AuthModeRemove(req.ID)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "reset-all-config", js: "ResetALLConfig", go: `Server.ResetALLConfig()\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-tour", js: "GetTour", args: ["newTour"], go: "return Server.GetTour(req.NewTour), nil", ret: "value" },
  { id: "app-get-editor-font-size", js: "AppGetEditorFontSize", go: "return Server.AppGetEditorFontSize(), nil", ret: "value" },
  { id: "app-set-editor-font-size", js: "AppSetEditorFontSize", args: ["size"], go: `Server.AppSetEditorFontSize(req.Size)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-ipv4-interface-adders", js: "GetIPV4InterfaceAdders", go: "return Server.GetIPV4InterfaceAdders(), nil", ret: "value" },
  { id: "get-interface-out-router-adders", js: "GetInterfaceOutRouterAdders", go: "return Server.GetInterfaceOutRouterAdders(), nil", ret: "value" },
  { id: "set-interface-out-router-adders", js: "SetInterfaceOutRouterAdders", args: ["ip"], go: `Server.SetInterfaceOutRouterAdders(req.IP)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-send-is-http1", js: "GetSendIsHTTP1", go: "return Server.GetSendIsHTTP1(), nil", ret: "value" },
  { id: "set-send-is-http1", js: "SetSendIsHTTP1", args: ["value"], go: `Server.SetSendIsHTTP1(req.Value)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-https-proto", js: "GetHTTPSProto", go: "return Server.GetHTTPSProto(), nil", ret: "value" },
  { id: "set-https-proto", js: "SetHTTPSProto", args: ["proto"], go: `Server.SetHTTPSProto(req.Proto)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "apply-https-protocol", js: "ApplyHTTPSProtocol", args: ["sendIsHTTP1", "protoJSON", "randomJa3"], go: "return Server.ApplyHTTPSProtocol(req.SendIsHTTP1, req.ProtoJSON, req.RandomJa3)" },
  { id: "get-random-ja3", js: "GetRandomJa3", go: "return Server.GetRandomJa3(), nil", ret: "value" },
  { id: "set-random-ja3", js: "SetRandomJa3", args: ["open"], go: `Server.SetRandomJa3(req.Open)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-must-tcp-roles", js: "GetMustTcpRoles", go: "return Server.GetMustTcpRoles(), nil", ret: "value" },
  { id: "get-must-tcp-type", js: "GetMustTcpType", go: "return Server.GetMustTcpType(), nil", ret: "value" },
  { id: "set-must-tcp-roles", js: "SetMustTcpRoles", args: ["type", "roles"], go: `Server.SetMustTcpRoles(req.Type, req.Roles)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-proxy-dns", js: "GetProxyDns", go: "return Server.GetProxyDns(), nil", ret: "value" },
  { id: "set-proxy-dns", js: "SetProxyDns", args: ["dns"], go: `Server.SetProxyDns(req.DNS)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "get-proxy-roles", js: "GetProxyRoles", go: "return Server.GetProxyRoles(), nil", ret: "value" },
  { id: "set-proxy-roles", js: "SetProxyRoles", args: ["roles"], go: `Server.SetProxyRoles(req.Roles)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "create-proxy-way", js: "CreateProxyWay", go: "return Server.CreateProxyWay(), nil", ret: "value" },
  { id: "proxy-way-list", js: "ProxyWayList", go: "return Server.ProxyWayList(), nil", ret: "value" },
  { id: "proxy-way-remove", js: "ProxyWayRemove", args: ["id"], go: `Server.ProxyWayRemove(req.ID)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "proxy-way-update", js: "ProxyWayUpdate", args: ["id", "url", "state", "note"], go: "return Server.ProxyWayUpdate(req.ID, req.URL, req.State, req.Note), nil", ret: "value" },
  { id: "reapply-engine-from-config", js: "ReapplyEngineFromConfig", go: "return Server.ReapplyEngineFromConfig(), nil", ret: "value" },
  { id: "create-replace-body", js: "CreateReplaceBody", go: "return Server.CreateReplaceBody(), nil", ret: "value" },
  { id: "replace-body-list", js: "ReplaceBodyList", go: "return Server.ReplaceBodyList(), nil", ret: "value" },
  { id: "replace-body-remove", js: "ReplaceBodyRemove", args: ["id"], go: `Server.ReplaceBodyRemove(req.ID)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "replace-body-update", js: "ReplaceBodyUpdate", args: ["id", "type", "source", "lod", "new", "note", "state"], go: "return Server.ReplaceBodyUpdate(req.ID, req.Type, req.Source, req.Lod, req.New, req.Note, req.State), nil", ret: "value" },
  { id: "create-replace-host", js: "CreateReplaceHost", go: "return Server.CreateReplaceHost(), nil", ret: "value" },
  { id: "replace-host-list", js: "ReplaceHostList", go: "return Server.ReplaceHostList(), nil", ret: "value" },
  { id: "replace-host-remove", js: "ReplaceHostRemove", args: ["id"], go: `Server.ReplaceHostRemove(req.ID)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "replace-host-update", js: "ReplaceHostUpdate", args: ["id", "lod", "new", "note"], go: "return Server.ReplaceHostUpdate(req.ID, req.Lod, req.New, req.Note), nil", ret: "value" },
  { id: "create-authentication", js: "CreateAuthentication", go: "return Server.CreateAuthentication(), nil", ret: "value" },
  { id: "authentication-list", js: "AuthenticationList", go: "return Server.AuthenticationList(), nil", ret: "value" },
  { id: "authentication-remove", js: "AuthenticationRemove", args: ["id"], go: `Server.AuthenticationRemove(req.ID)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "authentication-update", js: "AuthenticationUpdate", args: ["id", "user", "pass"], go: "return Server.AuthenticationUpdate(req.ID, req.User, req.Pass), nil", ret: "value" },
  { id: "create-request-cert", js: "CreateRequestCert", go: "return Server.CreateRequestCert(), nil", ret: "value" },
  { id: "request-list", js: "RequestList", go: "return Server.RequestList(), nil", ret: "value" },
  { id: "request-cert-remove", js: "RequestCertRemove", args: ["id"], go: `Server.RequestCertRemove(req.ID)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "request-cert-set-file", js: "RequestCertSetFile", args: ["id", "role", "doMain", "file", "pass", "note"], go: "return Server.RequestCertSetFile(req.ID, req.Role, req.DoMain, req.File, req.Pass, req.Note), nil", ret: "value" },
  { id: "request-cert-get-common-name", js: "RequestCertGetCommonName", args: ["id"], go: "return Server.RequestCertGetCommonName(req.ID), nil", ret: "value" },
  { id: "custom-tools-list", js: "CustomToolsList", go: "return Server.CustomToolsList(), nil", ret: "value" },
  { id: "custom-tools-add", js: "CustomToolsAdd", args: ["filePath"], go: "return Server.CustomToolsAdd(req.FilePath), nil", ret: "value" },
  { id: "custom-tools-del", js: "CustomToolsDel", args: ["id"], go: "return Server.CustomToolsDel(req.ID), nil", ret: "value" },
  { id: "exec-custom-tools", js: "ExecCustomTools", args: ["id"], go: "return Server.ExecCustomTools(req.ID), nil", ret: "value" },
  { id: "save-custom-tools", js: "SaveCustomTools", args: ["objInfo"], go: "return Server.SaveCustomTools(req.ObjInfo), nil", ret: "value" },
  { id: "clipboard-read-all", js: "ClipboardReadAll", go: "return Server.ClipboardReadAll(), nil", ret: "value" },
  { id: "clipboard-write-all", js: "ClipboardWriteAll", args: ["value"], go: "return Server.ClipboardWriteAll(req.Value), nil", ret: "value" },
  { id: "go-get-hex", js: "GoGetHex", args: ["data"], go: "return Server.GoGetHex(req.Data), nil", ret: "value" },
  { id: "protobuf-to-json", js: "ProtobufToJson", args: ["data", "skip"], go: "return Server.ProtobufToJson(req.Data, req.Skip), nil", ret: "value" },
  { id: "url-query-escape", js: "URLQueryEscape", args: ["value"], go: "return Server.URLQueryEscape(req.Value), nil", ret: "value" },
  { id: "url-query-unescape", js: "URLQueryUnescape", args: ["value"], go: "return Server.URLQueryUnescape(req.Value), nil", ret: "value" },
  { id: "free-all-request", js: "FreeAllRequest", go: `Server.FreeAllRequest()\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "list-search", js: "ListSearch", args: ["filterJson"], go: "return Server.ListSearch(req.FilterJSON), nil", ret: "value" },
  { id: "stream-search", js: "StreamSearch", args: ["theology", "filterJson"], go: "return Server.StreamSearch(req.Theology, req.FilterJSON), nil", ret: "value" },
  { id: "get-socket-filter", js: "GetSocketFilter", args: ["theology"], go: "return Server.GetSocketFilter(req.Theology), nil", ret: "value" },
  { id: "del-session-message-id-array", js: "DelSessionMessageIdArray", args: ["theology", "messageIdArray"], go: "return Server.DelSessionMessageIdArray(req.Theology, req.MessageIdArray), nil", ret: "value" },
  { id: "clear-all-session-message-id-array", js: "ClearAllSessionMessageIdArray", args: ["theology"], go: "return Server.ClearAllSessionMessageIdArray(req.Theology), nil", ret: "value" },
  { id: "copy-session-message-id-array", js: "CopySessionMessageIdArray", args: ["theology", "copyType", "messageIdArray"], go: "return Server.CopySessionMessageIdArray(req.Theology, req.CopyType, req.MessageIdArray), nil", ret: "value" },
  { id: "app-save-request-img", js: "AppSaveRequestImg", args: ["theology", "imgType", "isRequest", "path"], go: "return Server.AppSaveRequestImg(req.Theology, req.ImgType, req.IsRequest, req.Path), nil", ret: "value" },
  { id: "open-sunny-file", js: "OpenSunnyFile", args: ["prompt"], go: `p, err := Server.OpenSunnyFile(req.Prompt)\n\t\tif err != nil {\n\t\t\treturn "", nil\n\t\t}\n\t\treturn p, nil`, ret: "path" },
  { id: "save-sunny-file", js: "SaveSunnyFile", args: ["prompt"], go: `p, err := Server.SaveSunnyFile(req.Prompt)\n\t\tif err != nil {\n\t\t\treturn "", nil\n\t\t}\n\t\treturn p, nil`, ret: "path" },
  { id: "script-log-init", js: "ScriptLogInit", go: `Server.ScriptLogInit()\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "print-script-log", js: "PrintScriptLog", args: ["info"], go: `Server.PrintScriptLog(0, req.Info...)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "save-script-code", js: "SaveScriptCode", args: ["code"], go: `Server.SaveScriptCode(0, req.Code)\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "mcp-func-res", js: "McpFuncRes", args: ["page", "tag", "msg", "res", "id"], go: `Server.McpFuncRes(mcp.McpMsg{Page: req.Page, Tag: req.Tag, Msg: req.Msg, Res: req.Res, Id: req.ID})\n\t\treturn map[string]any{"ok": true}, nil` },
  { id: "is-load-device", js: "IsLoadDevice", go: "return Server.IsLoadDevice(), nil", ret: "value" },
];

const goField = {
  isDark: { n: "IsDark", t: "bool" },
  type: { n: "Type", t: "int", tag: `json:"type"` },
  theme: { n: "Theme", t: "string" },
  colorId: { n: "ColorID", t: "string", tag: `json:"colorId"` },
  color: { n: "Color", t: "string" },
  textMark: { n: "TextMark", t: "string", tag: `json:"textMark"` },
  obj: { n: "Obj", t: "string" },
  id: { n: "ID", t: "int", tag: `json:"id"` },
  value: { n: "Value", t: "bool" },
  columnState: { n: "ColumnState", t: "string", tag: `json:"columnState"` },
  disable: { n: "Disable", t: "bool" },
  size: { n: "Size", t: "int" },
  open: { n: "Open", t: "bool" },
  user: { n: "User", t: "string" },
  pass: { n: "Pass", t: "string" },
  newTour: { n: "NewTour", t: "bool", tag: `json:"newTour"` },
  ip: { n: "IP", t: "string", tag: `json:"ip"` },
  proto: { n: "Proto", t: "string" },
  sendIsHTTP1: { n: "SendIsHTTP1", t: "*bool", tag: `json:"sendIsHTTP1"` },
  protoJSON: { n: "ProtoJSON", t: "string", tag: `json:"protoJSON"` },
  randomJa3: { n: "RandomJa3", t: "*bool", tag: `json:"randomJa3"` },
  roles: { n: "Roles", t: "string" },
  dns: { n: "DNS", t: "string", tag: `json:"dns"` },
  url: { n: "URL", t: "string", tag: `json:"url"` },
  state: { n: "State", t: "string" },
  note: { n: "Note", t: "string" },
  source: { n: "Source", t: "string" },
  lod: { n: "Lod", t: "string" },
  new: { n: "New", t: "string", tag: `json:"new"` },
  doMain: { n: "DoMain", t: "string", tag: `json:"doMain"` },
  file: { n: "File", t: "string" },
  filePath: { n: "FilePath", t: "string", tag: `json:"filePath"` },
  objInfo: { n: "ObjInfo", t: "Config.ToolsInfo", tag: `json:"objInfo"` },
  data: { n: "Data", t: "[]byte" },
  skip: { n: "Skip", t: "int" },
  filterJson: { n: "FilterJSON", t: "string", tag: `json:"filterJson"` },
  theology: { n: "Theology", t: "int" },
  messageIdArray: { n: "MessageIdArray", t: "[]int", tag: `json:"messageIdArray"` },
  copyType: { n: "CopyType", t: "string", tag: `json:"copyType"` },
  imgType: { n: "ImgType", t: "string", tag: `json:"imgType"` },
  isRequest: { n: "IsRequest", t: "bool", tag: `json:"isRequest"` },
  path: { n: "Path", t: "string" },
  prompt: { n: "Prompt", t: "string" },
  info: { n: "Info", t: "[]any" },
  code: { n: "Code", t: "[]byte" },
  page: { n: "Page", t: "string" },
  tag: { n: "Tag", t: "string" },
  msg: { n: "Msg", t: "string" },
  res: { n: "Res", t: "string" },
};

// overrides for id fields that are strings
const stringIdCmds = new Set([
  "call-keys", "custom-tools-del", "exec-custom-tools",
]);
const stringIdAuth = new Set([]);

function goTypeFor(cmd, arg) {
  if (arg === "id") {
    if (cmd.id === "call-keys" || cmd.id === "custom-tools-del" || cmd.id === "exec-custom-tools") {
      return { n: "ID", t: "string", tag: `json:"id"` };
    }
    if (cmd.id === "mcp-func-res") {
      return { n: "ID", t: "uint32", tag: `json:"id"` };
    }
    return { n: "ID", t: "int", tag: `json:"id"` };
  }
  if (arg === "type") {
    if (cmd.id === "theme") return { n: "Type", t: "string", tag: `json:"type"` };
    if (cmd.id === "set-must-tcp-roles") return { n: "Type", t: "int", tag: `json:"type"` };
    return { n: "Type", t: "string", tag: `json:"type"` };
  }
  if (arg === "value") {
    if (cmd.id === "set-send-is-http1" || cmd.id === "set-is-edit-key-down") {
      return { n: "Value", t: "bool" };
    }
    if (cmd.id === "clipboard-write-all" || cmd.id === "url-query-escape" || cmd.id === "url-query-unescape") {
      return { n: "Value", t: "string" };
    }
  }
  if (goField[arg]) return goField[arg];
  const n = arg.charAt(0).toUpperCase() + arg.slice(1);
  return { n, t: "string", tag: `json:"${arg}"` };
}

function jsonTag(name, spec) {
  if (spec.tag) return spec.tag;
  return `json:"${name}"`;
}

let goBody = `package main

import (
	"encoding/json"

	"changeme/Service/Config"
	"changeme/Service/mcp"
	brickly "github.com/836145715/brickly-sdk-go"
)

func registerUICommands(on func(id string, fn func(input json.RawMessage) (any, error))) {
`;

for (const cmd of cmds) {
  const args = cmd.args || [];
  if (args.length === 0) {
    goBody += `\ton("${cmd.id}", func(json.RawMessage) (any, error) {\n\t\t${cmd.go}\n\t})\n`;
    continue;
  }
  const fields = args.map((a) => {
    const spec = goTypeFor(cmd, a);
    if (!spec) throw new Error(`missing field spec ${cmd.id} ${a}`);
    return `\t\t\t${spec.n} ${spec.t} \`${jsonTag(a, spec)}\``;
  });
  goBody += `\ton("${cmd.id}", func(input json.RawMessage) (any, error) {
		var req struct {
${fields.join("\n")}
		}
		if err := decodeJSON(input, &req); err != nil {
			return nil, brickly.NewBppError("BAD_REQUEST", err.Error())
		}
		${cmd.go}
	})
`;
}

goBody += "}\n";

const goPath = path.join(brick, "runtime/go/uicommands.go");
fs.writeFileSync(goPath, goBody);
console.log("wrote", goPath);

const publicMap = [
  ["Start", "start-capture", []],
  ["Shutdown", "stop-capture", []],
  ["AppCheckSunnyNet", "capture-status", []],
  ["GetError", "capture-error", []],
  ["AppVersion", "capture-version", []],
  ["GetPort", "get-port", []],
  ["SetPort", "set-port", ["port", "noStart"]],
  ["AppIsSetPort", "is-port-set", []],
  ["SetIEProxy", "set-system-proxy", []],
  ["CancelIEProxy", "clear-system-proxy", []],
  ["SetWorking", "set-working", ["working"]],
  ["GOOS", "goos", []],
  ["GetHTTPSession", "get-session", ["theology"]],
  ["GetHTTPRequestBody", "get-request-body", ["theology", "getAll"]],
  ["GetHTTPResponseBody", "get-response-body", ["theology", "getAll"]],
  ["GetSessionMessageBody", "get-session-message-body", ["theology", "messageId"]],
  ["GetAllStream", "get-all-stream", ["theology"]],
  ["AppDeleteSession", "delete-sessions", ["ids"]],
  ["ClearAllSession", "clear-sessions", []],
  ["FindSession", "find-sessions", ["info"]],
  ["AppExport", "export-sessions", ["list", "savePath"]],
  ["AppImport", "import-sessions", ["filePath"]],
  ["AppResendRequest", "resend-request", ["id", "count", "breakMode"]],
  ["UpdateNote", "update-note", ["theology", "note"]],
  ["SessionActiveSend", "active-send", ["theology", "isSendServer", "sendType", "wsType", "body"]],
  ["AppDisconnectTCPRequest", "disconnect-tcp", ["ids"]],
  ["SetBreakMode", "set-break-mode", ["working"]],
  ["SetRequestNextBreakMode", "set-request-next-break-mode", ["theology", "working"]],
  ["UpdateHttpRequest", "update-http-request", ["theology", "request"]],
  ["UpdateHttpResponse", "update-http-response", ["theology", "response"]],
  ["ExportCert", "export-cert", ["path"]],
  ["GetAllProcessesList", "list-processes", []],
  ["ProcessAddName", "process-add-name", ["name"]],
  ["ProcessDelName", "process-del-name", ["name"]],
  ["ProcessAddPid", "process-add-pid", ["pid"]],
  ["ProcessDelPid", "process-del-pid", ["pid"]],
  ["ProcessAny", "process-any", ["open", "stopNetwork"]],
  ["LoadDevice", "load-device", ["mode"]],
  ["SetDeviceStopUpdate", "set-device-stop-update", ["stop"]],
  ["MCPStatusJSON", "mcp-status", []],
  ["MCPListOpsJSON", "mcp-list-ops", []],
  ["MCPEnable", "mcp-enable", ["port"]],
  ["MCPDisable", "mcp-disable", []],
];

const jsArgAlias = {
  getAllBody: "getAll",
  Theology: "theology",
  MessageId: "messageId",
  tid: "ids",
  BreakMode: "breakMode",
  Note: "note",
  isSendServer: "isSendServer",
  SendType: "sendType",
  wsType: "wsType",
  _bs: "body",
  req: "request",
  StopNetwork: "stopNetwork",
  ColorID: "colorId",
  IsDark: "isDark",
  TextMark: "textMark",
  ColumnState: "columnState",
  Disable: "disable",
  User: "user",
  Pass: "pass",
  Type: "type",
  Roles: "roles",
  URL: "url",
  State: "state",
  Note: "note",
  Source: "source",
  Lod: "lod",
  New: "new",
  DoMain: "doMain",
  FilterJson: "filterJson",
  CopyType: "copyType",
  MessageIdArray: "messageIdArray",
  ImgType: "imgType",
  IsRequest: "isRequest",
  objInfo: "objInfo",
  filePath: "filePath",
  savePath: "savePath",
  noStart: "noStart",
};

let api = `// Brickly named-command client. Vue keeps old function names; calls go through invoke.
import { invoke } from "./core.js";

`;

function jsFn(name, id, args, extra) {
  if (name === "AppDisconnectTCPRequest") {
    return `export function AppDisconnectTCPRequest(id) {
  const ids = Array.isArray(id) ? id : [id];
  return invoke("disconnect-tcp", { ids });
}
`;
  }
  if (name === "FindSession") {
    return `export function FindSession(info) { return invoke("find-sessions", { info }); }
`;
  }
  if (name === "AppImport") {
    return `export async function AppImport(filePath) {
  const r = await invoke("import-sessions", { filePath });
  if (Array.isArray(r)) return r;
  return [r?.error ?? "", r?.list ?? []];
}
`;
  }
  if (name === "AppDeleteSession") {
    return `export function AppDeleteSession(tid) {
  const ids = Array.isArray(tid) ? tid : [tid];
  return invoke("delete-sessions", { ids });
}
`;
  }
  if (name === "GetHTTPRequestBody") {
    return `export function GetHTTPRequestBody(theology, getAll) { return invoke("get-request-body", { theology, getAll }); }
`;
  }
  if (name === "GetHTTPResponseBody") {
    return `export function GetHTTPResponseBody(theology, getAll) { return invoke("get-response-body", { theology, getAll }); }
`;
  }
  if (name === "SessionActiveSend") {
    return `export function SessionActiveSend(theology, isSendServer, sendType, wsType, body) {
  return invoke("active-send", { theology, isSendServer, sendType, wsType, body });
}
`;
  }
  if (name === "UpdateHttpRequest") {
    return `export function UpdateHttpRequest(theology, request) { return invoke("update-http-request", { theology, request }); }
`;
  }
  if (name === "UpdateHttpResponse") {
    return `export function UpdateHttpResponse(theology, response) { return invoke("update-http-response", { theology, response }); }
`;
  }
  if (name === "McpFuncRes") {
    return `export function McpFuncRes(res) {
  const m = res && typeof res === "object" ? res : {};
  return invoke("mcp-func-res", { page: m.page, tag: m.tag, msg: m.msg, res: m.res, id: m.id });
}
`;
  }
  if (name === "PrintScriptLog") {
    return `export function PrintScriptLog($0, ...info) { return invoke("print-script-log", { info }); }
`;
  }
  if (name === "SaveScriptCode") {
    return `export function SaveScriptCode($0, code) { return invoke("save-script-code", { code }); }
`;
  }
  if (name === "CallTools") {
    return `export function CallTools(name, open, args) {
  return invoke("open-tool-window", { name, open: open === undefined || open === null ? true : open, args: args ?? "" });
}
`;
  }
  if (name === "Theme") {
    return `export function Theme(isDark, type, theme) { return invoke("theme", { isDark, type, theme }); }
`;
  }
  if (name === "SetListColor") {
    return `export function SetListColor(isDark, colorId, color) { return invoke("set-list-color", { isDark, colorId, color }); }
`;
  }
  if (name === "ReplaceBodyUpdate") {
    return `export function ReplaceBodyUpdate(id, type, source, lod, neu, note, state) {
  return invoke("replace-body-update", { id, type, source, lod, new: neu, note, state });
}
`;
  }
  if (name === "ReplaceHostUpdate") {
    return `export function ReplaceHostUpdate(id, lod, neu, note) {
  return invoke("replace-host-update", { id, lod, new: neu, note });
}
`;
  }
  if (name === "SetMustTcpRoles") {
    return `export function SetMustTcpRoles(type, roles) { return invoke("set-must-tcp-roles", { type, roles }); }
`;
  }
  if (name === "ProtobufToJson") {
    return `export function ProtobufToJson(data, skip) { return invoke("protobuf-to-json", { data, skip }); }
`;
  }
  if (name === "GoGetHex") {
    return `export function GoGetHex(data) { return invoke("go-get-hex", { data }); }
`;
  }
  if (!args.length) {
    return `export function ${name}() { return invoke(${JSON.stringify(id)}); }\n`;
  }
  const obj = args.map((a) => a).join(", ");
  const params = args.join(", ");
  return `export function ${name}(${params}) { return invoke(${JSON.stringify(id)}, { ${obj} }); }\n`;
}

for (const [name, id, args] of publicMap) {
  api += jsFn(name, id, args);
}
api += `export function CallTools(name, open, args) {
  return invoke("open-tool-window", { name, open: open === undefined || open === null ? true : open, args: args ?? "" });
}
`;
for (const cmd of cmds) {
  api += jsFn(cmd.js, cmd.id, cmd.args || []);
}

const apiPath = path.join(brick, "frontend/src/brickly/api.js");
fs.mkdirSync(path.dirname(apiPath), { recursive: true });
fs.writeFileSync(apiPath, api);
console.log("wrote", apiPath, "cmds", cmds.length);

const uiIds = cmds.map((c) => c.id);
fs.writeFileSync(path.join(here, "ui-command-ids.json"), JSON.stringify(uiIds, null, 2) + "\n");
console.log("wrote ui-command-ids.json", uiIds.length);

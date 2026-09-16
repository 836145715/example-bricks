// Brickly named-command client. Vue keeps old function names; calls go through invoke.
import { invoke } from "./core.js";
import { OpenTools } from "../components/config/toolModal.js";

export function Start() { return invoke("start-capture"); }
export function Shutdown() { return invoke("stop-capture"); }
export function AppCheckSunnyNet() { return invoke("capture-status"); }
export function GetError() { return invoke("capture-error"); }
export function AppVersion() { return invoke("capture-version"); }
export function GetPort() { return invoke("get-port"); }
export function SetPort(port, noStart) { return invoke("set-port", { port, noStart }); }
export function AppIsSetPort() { return invoke("is-port-set"); }
export function SetIEProxy() { return invoke("set-system-proxy"); }
export function CancelIEProxy() { return invoke("clear-system-proxy"); }
export function SetWorking(working) { return invoke("set-working", { working }); }
export function GOOS() { return invoke("goos"); }
export function GetHTTPSession(theology) { return invoke("get-session", { theology }); }
export function GetHTTPRequestBody(theology, getAll) { return invoke("get-request-body", { theology, getAll }); }
export function GetHTTPResponseBody(theology, getAll) { return invoke("get-response-body", { theology, getAll }); }
export function GetSessionMessageBody(theology, messageId) { return invoke("get-session-message-body", { theology, messageId }); }
export function GetAllStream(theology) { return invoke("get-all-stream", { theology }); }
export function AppDeleteSession(tid) {
  const ids = Array.isArray(tid) ? tid : [tid];
  return invoke("delete-sessions", { ids });
}
export function ClearAllSession() { return invoke("clear-sessions"); }
export function FindSession(info) { return invoke("find-sessions", { info }); }
export function AppExport(list, savePath) { return invoke("export-sessions", { list, savePath }); }
export async function AppImport(filePath) {
  const r = await invoke("import-sessions", { filePath });
  if (Array.isArray(r)) return r;
  return [r?.error ?? "", r?.list ?? []];
}
export function AppResendRequest(id, count, breakMode) { return invoke("resend-request", { id, count, breakMode }); }
export function UpdateNote(theology, note) { return invoke("update-note", { theology, note }); }
export function SessionActiveSend(theology, isSendServer, sendType, wsType, body) {
  return invoke("active-send", { theology, isSendServer, sendType, wsType, body });
}
export function AppDisconnectTCPRequest(id) {
  const ids = Array.isArray(id) ? id : [id];
  return invoke("disconnect-tcp", { ids });
}
export function SetBreakMode(working) { return invoke("set-break-mode", { working }); }
export function SetRequestNextBreakMode(theology, working) { return invoke("set-request-next-break-mode", { theology, working }); }
export function UpdateHttpRequest(theology, request) { return invoke("update-http-request", { theology, request }); }
export function UpdateHttpResponse(theology, response) { return invoke("update-http-response", { theology, response }); }
export function ExportCert(path) { return invoke("export-cert", { path }); }
export function GetAllProcessesList() { return invoke("list-processes"); }
export function ProcessAddName(name) { return invoke("process-add-name", { name }); }
export function ProcessDelName(name) { return invoke("process-del-name", { name }); }
export function ProcessAddPid(pid) { return invoke("process-add-pid", { pid }); }
export function ProcessDelPid(pid) { return invoke("process-del-pid", { pid }); }
export function ProcessAny(open, stopNetwork) { return invoke("process-any", { open, stopNetwork }); }
export function LoadDevice(mode) { return invoke("load-device", { mode }); }
export function SetDeviceStopUpdate(stop) { return invoke("set-device-stop-update", { stop }); }
export function MCPStatusJSON() { return invoke("mcp-status"); }
export function MCPListOpsJSON() { return invoke("mcp-list-ops"); }
export function MCPEnable(port) { return invoke("mcp-enable", { port }); }
export function MCPDisable() { return invoke("mcp-disable"); }
export function CallTools(name, open, args) {
  return OpenTools(name, open, args);
}
export function IsDark() { return invoke("is-dark"); }
export function SetIsDark(isDark) { return invoke("set-is-dark", { isDark }); }
export function Theme(isDark, type, theme) { return invoke("theme", { isDark, type, theme }); }
export function AppGetTheme(isDark) { return invoke("app-get-theme", { isDark }); }
export function GetAgGridLightTheme() { return invoke("get-ag-grid-light-theme"); }
export function GetAgGridDarkTheme() { return invoke("get-ag-grid-dark-theme"); }
export function GetListColor(isDark) { return invoke("get-list-color", { isDark }); }
export function SetListColor(isDark, colorId, color) { return invoke("set-list-color", { isDark, colorId, color }); }
export function DefaultColor(isDark) { return invoke("default-color", { isDark }); }
export function GetHomeTextMark() { return invoke("get-home-text-mark"); }
export function SetHomeTextMark(textMark) { return invoke("set-home-text-mark", { textMark }); }
export function GetKeys() { return invoke("get-keys"); }
export function SetKeys(obj) { return invoke("set-keys", { obj }); }
export function CallKeys(id) { return invoke("call-keys", { id }); }
export function SetIsEditKeyDown(value) { return invoke("set-is-edit-key-down", { value }); }
export function GetColumnState() { return invoke("get-column-state"); }
export function SetColumnState(columnState) { return invoke("set-column-state", { columnState }); }
export function GetBaseSettingsValue() { return invoke("get-base-settings-value"); }
export function SetDisableTCP(disable) { return invoke("set-disable-tcp", { disable }); }
export function SetDisableUDP(disable) { return invoke("set-disable-udp", { disable }); }
export function SetDisableCache(disable) { return invoke("set-disable-cache", { disable }); }
export function SetLimitRequestSize(size) { return invoke("set-limit-request-size", { size }); }
export function SetAuthMode(open) { return invoke("set-auth-mode", { open }); }
export function AuthModeCreate() { return invoke("auth-mode-create"); }
export function AuthModeList() { return invoke("auth-mode-list"); }
export function AuthModeSet(id, user, pass) { return invoke("auth-mode-set", { id, user, pass }); }
export function AuthModeRemove(id) { return invoke("auth-mode-remove", { id }); }
export function ResetALLConfig() { return invoke("reset-all-config"); }
export function GetTour(newTour) { return invoke("get-tour", { newTour }); }
export function AppGetEditorFontSize() { return invoke("app-get-editor-font-size"); }
export function AppSetEditorFontSize(size) { return invoke("app-set-editor-font-size", { size }); }
export function GetIPV4InterfaceAdders() { return invoke("get-ipv4-interface-adders"); }
export function GetInterfaceOutRouterAdders() { return invoke("get-interface-out-router-adders"); }
export function SetInterfaceOutRouterAdders(ip) { return invoke("set-interface-out-router-adders", { ip }); }
export function GetSendIsHTTP1() { return invoke("get-send-is-http1"); }
export function SetSendIsHTTP1(value) { return invoke("set-send-is-http1", { value }); }
export function GetHTTPSProto() { return invoke("get-https-proto"); }
export function SetHTTPSProto(proto) { return invoke("set-https-proto", { proto }); }
export function ApplyHTTPSProtocol(sendIsHTTP1, protoJSON, randomJa3) { return invoke("apply-https-protocol", { sendIsHTTP1, protoJSON, randomJa3 }); }
export function GetRandomJa3() { return invoke("get-random-ja3"); }
export function SetRandomJa3(open) { return invoke("set-random-ja3", { open }); }
export function GetMustTcpRoles() { return invoke("get-must-tcp-roles"); }
export function GetMustTcpType() { return invoke("get-must-tcp-type"); }
export function SetMustTcpRoles(type, roles) { return invoke("set-must-tcp-roles", { type, roles }); }
export function GetProxyDns() { return invoke("get-proxy-dns"); }
export function SetProxyDns(dns) { return invoke("set-proxy-dns", { dns }); }
export function GetProxyRoles() { return invoke("get-proxy-roles"); }
export function SetProxyRoles(roles) { return invoke("set-proxy-roles", { roles }); }
export function CreateProxyWay() { return invoke("create-proxy-way"); }
export function ProxyWayList() { return invoke("proxy-way-list"); }
export function ProxyWayRemove(id) { return invoke("proxy-way-remove", { id }); }
export function ProxyWayUpdate(id, url, state, note) { return invoke("proxy-way-update", { id, url, state, note }); }
export function ReapplyEngineFromConfig() { return invoke("reapply-engine-from-config"); }
export function CreateReplaceBody() { return invoke("create-replace-body"); }
export function ReplaceBodyList() { return invoke("replace-body-list"); }
export function ReplaceBodyRemove(id) { return invoke("replace-body-remove", { id }); }
export function ReplaceBodyUpdate(id, type, source, lod, neu, note, state) {
  return invoke("replace-body-update", { id, type, source, lod, new: neu, note, state });
}
export function CreateReplaceHost() { return invoke("create-replace-host"); }
export function ReplaceHostList() { return invoke("replace-host-list"); }
export function ReplaceHostRemove(id) { return invoke("replace-host-remove", { id }); }
export function ReplaceHostUpdate(id, lod, neu, note) {
  return invoke("replace-host-update", { id, lod, new: neu, note });
}
export function CreateAuthentication() { return invoke("create-authentication"); }
export function AuthenticationList() { return invoke("authentication-list"); }
export function AuthenticationRemove(id) { return invoke("authentication-remove", { id }); }
export function AuthenticationUpdate(id, user, pass) { return invoke("authentication-update", { id, user, pass }); }
export function CreateRequestCert() { return invoke("create-request-cert"); }
export function RequestList() { return invoke("request-list"); }
export function RequestCertRemove(id) { return invoke("request-cert-remove", { id }); }
export function RequestCertSetFile(id, role, doMain, file, pass, note) { return invoke("request-cert-set-file", { id, role, doMain, file, pass, note }); }
export function RequestCertGetCommonName(id) { return invoke("request-cert-get-common-name", { id }); }
export function CustomToolsList() { return invoke("custom-tools-list"); }
export function CustomToolsAdd(filePath) { return invoke("custom-tools-add", { filePath }); }
export function CustomToolsDel(id) { return invoke("custom-tools-del", { id }); }
export function ExecCustomTools(id) { return invoke("exec-custom-tools", { id }); }
export function SaveCustomTools(objInfo) { return invoke("save-custom-tools", { objInfo }); }
export function ClipboardReadAll() { return invoke("clipboard-read-all"); }
export function ClipboardWriteAll(value) { return invoke("clipboard-write-all", { value }); }
export function GoGetHex(data) { return invoke("go-get-hex", { data }); }
export function ProtobufToJson(data, skip) { return invoke("protobuf-to-json", { data, skip }); }
export function URLQueryEscape(value) { return invoke("url-query-escape", { value }); }
export function URLQueryUnescape(value) { return invoke("url-query-unescape", { value }); }
export function FreeAllRequest() { return invoke("free-all-request"); }
export function ListSearch(filterJson) { return invoke("list-search", { filterJson }); }
export function StreamSearch(theology, filterJson) { return invoke("stream-search", { theology, filterJson }); }
export function GetSocketFilter(theology) { return invoke("get-socket-filter", { theology }); }
export function DelSessionMessageIdArray(theology, messageIdArray) { return invoke("del-session-message-id-array", { theology, messageIdArray }); }
export function ClearAllSessionMessageIdArray(theology) { return invoke("clear-all-session-message-id-array", { theology }); }
export function CopySessionMessageIdArray(theology, copyType, messageIdArray) { return invoke("copy-session-message-id-array", { theology, copyType, messageIdArray }); }
export function AppSaveRequestImg(theology, imgType, isRequest, path) { return invoke("app-save-request-img", { theology, imgType, isRequest, path }); }
export function OpenSunnyFile(prompt) { return invoke("open-sunny-file", { prompt }); }
export function SaveSunnyFile(prompt) { return invoke("save-sunny-file", { prompt }); }
export function ScriptLogInit() { return invoke("script-log-init"); }
export function PrintScriptLog($0, ...info) { return invoke("print-script-log", { info }); }
export function SaveScriptCode($0, code) { return invoke("save-script-code", { code }); }
export function McpFuncRes(res) {
  const m = res && typeof res === "object" ? res : {};
  return invoke("mcp-func-res", { page: m.page, tag: m.tag, msg: m.msg, res: m.res, id: m.id });
}
export function IsLoadDevice() { return invoke("is-load-device"); }

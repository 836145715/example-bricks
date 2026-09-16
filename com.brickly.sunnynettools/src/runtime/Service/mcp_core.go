package Service

import (
	"changeme/Service/Config"
	Session "changeme/internal/session"
)

// MCPCore is the UI-free surface MCP ops may use. *AppMain implements it.
// Handlers must not assume windows, dialogs, or EmitEvent.
type MCPCore interface {
	GetPort() int
	SetPort(int, bool) string
	Start()
	Shutdown()
	GetError() string
	SetIEProxy() bool
	CancelIEProxy() bool
	SetWorking(bool)
	ClearAllSession() []int
	AppDeleteSession([]int)
	IsLoadDevice() bool
	LoadDevice(int) bool
	ProcessAddName(string)
	ProcessDelName(string)
	ProcessAddPid(int)
	ProcessDelPid(int)
	ProcessAny(bool, bool)
	GetBaseSettingsValue() (bool, bool, bool, bool, int)
	GetRandomJa3() bool
	GetHTTPSProto() string
	FreeAllRequest()
	FindSession(*FindInfo) []int
	AppImport(string) (string, []Session.Insert)
	AppExport([]int, string) string
	UpdateHttpRequest(int, *Session.HttpSessionRequest)
	UpdateHttpResponse(int, *Session.HttpSessionResponse)
	AppResendRequest(int, int, int) bool
	SessionActiveSend(int, bool, string, int, []byte) string
	ProtobufToJson([]byte, int) string
	GetSessionMessageBody(int, int) []byte
	SetDisableTCP(bool)
	SetDisableUDP(bool)
	SetDisableCache(bool)
	SetAuthMode(bool)
	SetLimitRequestSize(int)
	SetProxyRoles(string)
	SetProxyDns(string)
	GetProxyDns() string
	GetProxyRoles() string
	SetMustTcpRoles(int, string)
	GetMustTcpType() int
	GetMustTcpRoles() string
	SetInterfaceOutRouterAdders(string)
	SetHTTPSProto(string)
	GetSendIsHTTP1() bool
	ApplyHTTPSProtocol(*bool, string, *bool) (map[string]any, error)
	ReapplyEngineFromConfig() map[string]any
	ProxyWayList() []Config.ProxyWayInfo
	CreateProxyWay() int
	ProxyWayUpdate(int, string, string, string) bool
	ProxyWayRemove(int)
	RequestList() []Config.CertInfo
	CreateRequestCert() int
	RequestCertSetFile(int, string, string, string, string, string) string
	RequestCertRemove(int)
	ReplaceBodyList() []Config.ReplaceBodyInfo
	CreateReplaceBody() int
	ReplaceBodyUpdate(int, string, string, string, string, string, string) any
	ReplaceHostList() []Config.ReplaceHostInfo
	CreateReplaceHost() int
	ReplaceHostUpdate(int, string, string, string) bool
	ReplaceHostRemove(int)
}

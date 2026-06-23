package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"brickly/net-capture/internal/stdoutguard"
	brickly "github.com/836145715/brickly-sdk-go"
	"github.com/qtgolang/SunnyNet/SunnyNet"
	sunnyHTTP "github.com/qtgolang/SunnyNet/src/http"
	"github.com/qtgolang/SunnyNet/src/public"
)

const (
	brickID           = "com.brickly.net-capture"
	protocolVersion   = "0.1.0"
	changeEvent       = "net-capture:changed"
	defaultPort       = 2025
	maxSessions       = 12000
	eventQueueSize    = 65536
	publishInterval   = 220 * time.Millisecond
	maxListLimit      = 1200
	defaultPreviewCap = 4096
)

var buildStamp = "dev"

var (
	capture = newCaptureService()
	plugin  *brickly.Runtime
)

type startOptions struct {
	Port                int
	InstallCert         bool
	SetSystemProxy      bool
	CaptureTCP          bool
	CaptureUDP          bool
	MaxBodyPreviewBytes int
	DriverMode          string
	ProcessNames        []string
	ProcessPIDs         []int
	CaptureAllProcesses bool
	StopNetworkOnce     bool
}

type captureStatus struct {
	Running             bool                 `json:"running"`
	Port                int                  `json:"port"`
	ProxyURL            string               `json:"proxyUrl"`
	SystemProxy         bool                 `json:"systemProxy"`
	CaptureTCP          bool                 `json:"captureTcp"`
	CaptureUDP          bool                 `json:"captureUdp"`
	DriverMode          string               `json:"driverMode"`
	MaxBodyPreviewBytes int                  `json:"maxBodyPreviewBytes"`
	SunnyVersion        string               `json:"sunnyVersion"`
	GoVersion           string               `json:"goVersion"`
	GOOS                string               `json:"goos"`
	GOARCH              string               `json:"goarch"`
	BuildStamp          string               `json:"buildStamp"`
	Total               uint64               `json:"total"`
	Dropped             uint64               `json:"dropped"`
	QueueDepth          int                  `json:"queueDepth"`
	LastID              uint64               `json:"lastId"`
	Error               string               `json:"error,omitempty"`
	Capabilities        platformCapabilities `json:"capabilities"`
}

type platformCapabilities struct {
	PlatformKey string                 `json:"platformKey"`
	GOOS        string                 `json:"goos"`
	GOARCH      string                 `json:"goarch"`
	SystemProxy bool                   `json:"systemProxy"`
	InstallCert bool                   `json:"installCert"`
	DriverModes []driverModeCapability `json:"driverModes"`
	Notes       []string               `json:"notes,omitempty"`
}

type driverModeCapability struct {
	Value     string `json:"value"`
	Label     string `json:"label"`
	Supported bool   `json:"supported"`
	Reason    string `json:"reason,omitempty"`
}

type captureEvent struct {
	ID              uint64            `json:"id"`
	ParentID        uint64            `json:"parentId,omitempty"`
	Protocol        string            `json:"protocol"`
	Phase           string            `json:"phase"`
	Method          string            `json:"method,omitempty"`
	URL             string            `json:"url,omitempty"`
	Host            string            `json:"host,omitempty"`
	Path            string            `json:"path,omitempty"`
	Status          int               `json:"status,omitempty"`
	Proto           string            `json:"proto,omitempty"`
	PID             int               `json:"pid,omitempty"`
	Process         string            `json:"process,omitempty"`
	ClientIP        string            `json:"clientIp,omitempty"`
	LocalAddress    string            `json:"localAddress,omitempty"`
	RemoteAddress   string            `json:"remoteAddress,omitempty"`
	Direction       string            `json:"direction,omitempty"`
	MessageType     int               `json:"messageType,omitempty"`
	RequestBytes    int               `json:"requestBytes,omitempty"`
	ResponseBytes   int               `json:"responseBytes,omitempty"`
	BodyBytes       int               `json:"bodyBytes,omitempty"`
	DurationMs      int64             `json:"durationMs,omitempty"`
	Error           string            `json:"error,omitempty"`
	RequestHeader   map[string]string `json:"requestHeader,omitempty"`
	ResponseHeader  map[string]string `json:"responseHeader,omitempty"`
	RequestPreview  string            `json:"requestPreview,omitempty"`
	ResponsePreview string            `json:"responsePreview,omitempty"`
	BodyPreview     string            `json:"bodyPreview,omitempty"`
	BodyBase64      string            `json:"bodyBase64,omitempty"`
	CreatedAt       int64             `json:"createdAt"`
	UpdatedAt       int64             `json:"updatedAt"`
}

type sessionRow struct {
	ID            uint64 `json:"id"`
	Protocol      string `json:"protocol"`
	Phase         string `json:"phase"`
	Method        string `json:"method,omitempty"`
	URL           string `json:"url,omitempty"`
	Host          string `json:"host,omitempty"`
	Path          string `json:"path,omitempty"`
	Status        int    `json:"status,omitempty"`
	PID           int    `json:"pid,omitempty"`
	Process       string `json:"process,omitempty"`
	Direction     string `json:"direction,omitempty"`
	LocalAddress  string `json:"localAddress,omitempty"`
	RemoteAddress string `json:"remoteAddress,omitempty"`
	RequestBytes  int    `json:"requestBytes,omitempty"`
	ResponseBytes int    `json:"responseBytes,omitempty"`
	BodyBytes     int    `json:"bodyBytes,omitempty"`
	DurationMs    int64  `json:"durationMs,omitempty"`
	Error         string `json:"error,omitempty"`
	CreatedAt     int64  `json:"createdAt"`
	UpdatedAt     int64  `json:"updatedAt"`
}

type captureService struct {
	mu                  sync.RWMutex
	sunny               *SunnyNet.Sunny
	running             bool
	port                int
	systemProxy         bool
	captureTCP          bool
	captureUDP          bool
	driverMode          string
	maxBodyPreviewBytes int
	lastError           string
	nextID              atomic.Uint64
	total               atomic.Uint64
	dropped             atomic.Uint64
	queue               chan captureEvent
	sessions            []captureEvent
	byID                map[uint64]int
	lastPublish         time.Time
	publishPending      bool
}

func newCaptureService() *captureService {
	s := &captureService{
		port:                defaultPort,
		captureTCP:          true,
		captureUDP:          true,
		driverMode:          "off",
		maxBodyPreviewBytes: defaultPreviewCap,
		queue:               make(chan captureEvent, eventQueueSize),
		sessions:            make([]captureEvent, 0, maxSessions),
		byID:                make(map[uint64]int, maxSessions),
	}
	go s.consumeEvents()
	return s
}

func (s *captureService) start(options startOptions) (captureStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return s.statusLocked(), nil
	}
	if options.Port <= 0 {
		options.Port = defaultPort
	}
	if options.MaxBodyPreviewBytes <= 0 {
		options.MaxBodyPreviewBytes = defaultPreviewCap
	}
	s.port = options.Port
	s.captureTCP = options.CaptureTCP
	s.captureUDP = options.CaptureUDP
	s.driverMode = normalizeDriverMode(options.DriverMode)
	s.maxBodyPreviewBytes = clamp(options.MaxBodyPreviewBytes, 512, 128*1024)
	s.lastError = ""

	if ok, reason := supportsDriverMode(s.driverMode); !ok {
		s.driverMode = "off"
		s.lastError = reason
		return s.statusLocked(), errors.New(reason)
	}

	sunny := SunnyNet.NewSunny()
	sunny.SetGoCallback(s.onHTTP, s.onTCP, s.onWS, s.onUDP)
	sunny.SetPort(s.port)
	sunny.SetHTTPRequestMaxUpdateLength(int64(s.maxBodyPreviewBytes))
	if !s.captureTCP {
		sunny.DisableTCP(true)
	}
	if !s.captureUDP {
		sunny.DisableUDP(true)
	}
	if s.driverMode != "off" {
		mode := driverModeValue(s.driverMode)
		if mode < 0 || !sunny.OpenDrive(mode) {
			sunny.Close()
			s.lastError = "驱动模式启动失败，可能需要管理员权限或驱动未被系统信任"
			return s.statusLocked(), errors.New(s.lastError)
		}
		for _, name := range options.ProcessNames {
			if strings.TrimSpace(name) != "" {
				sunny.ProcessAddName(strings.TrimSpace(name))
			}
		}
		for _, pid := range options.ProcessPIDs {
			if pid > 0 {
				sunny.ProcessAddPid(pid)
			}
		}
		if options.CaptureAllProcesses {
			sunny.ProcessALLName(true, options.StopNetworkOnce)
		}
	}
	sunny.Start()
	if sunny.Error != nil {
		sunny.Close()
		s.lastError = sunny.Error.Error()
		return s.statusLocked(), sunny.Error
	}
	s.sunny = sunny
	s.running = true
	if options.InstallCert {
		if result := sunny.InstallCert(); strings.TrimSpace(result) != "" {
			logf("install cert: %s", result)
		}
	}
	if options.SetSystemProxy && platformCapabilitiesForRuntime().SystemProxy {
		s.systemProxy = sunny.SetIEProxy()
	}
	s.publishSoonLocked()
	return s.statusLocked(), nil
}

func (s *captureService) stop() captureStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sunny != nil {
		if s.systemProxy {
			s.sunny.CancelIEProxy()
		}
		s.sunny.ProcessCancelAll()
		s.sunny.Close()
	}
	s.sunny = nil
	s.running = false
	s.systemProxy = false
	s.publishSoonLocked()
	return s.statusLocked()
}

func (s *captureService) setSystemProxy(enabled bool) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !platformCapabilitiesForRuntime().SystemProxy {
		return map[string]any{"ok": false, "enabled": false}, errors.New("当前平台不支持自动设置系统代理")
	}
	if s.sunny == nil || !s.running {
		return map[string]any{"ok": false, "enabled": false}, errors.New("抓包服务未运行")
	}
	ok := false
	if enabled {
		ok = s.sunny.SetIEProxy()
		s.systemProxy = ok
	} else {
		ok = s.sunny.CancelIEProxy()
		s.systemProxy = false
	}
	s.publishSoonLocked()
	return map[string]any{"ok": ok, "enabled": s.systemProxy}, nil
}

func (s *captureService) installCert() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !platformCapabilitiesForRuntime().InstallCert {
		return map[string]any{"ok": false, "message": "当前平台不支持自动安装根证书"}
	}
	sunny := s.sunny
	temp := false
	if sunny == nil {
		sunny = SunnyNet.NewSunny()
		temp = true
	}
	message := installRootCertificate(sunny)
	if temp {
		sunny.Close()
	}
	return map[string]any{"ok": strings.TrimSpace(message) == "", "message": message}
}

func (s *captureService) clear() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions = s.sessions[:0]
	s.byID = make(map[uint64]int, maxSessions)
	s.publishSoonLocked()
	return map[string]any{"ok": true}
}

func (s *captureService) status() captureStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statusLocked()
}

func (s *captureService) statusLocked() captureStatus {
	proxyURL := ""
	if s.port > 0 {
		proxyURL = fmt.Sprintf("http://127.0.0.1:%d", s.port)
	}
	return captureStatus{
		Running:             s.running,
		Port:                s.port,
		ProxyURL:            proxyURL,
		SystemProxy:         s.systemProxy,
		CaptureTCP:          s.captureTCP,
		CaptureUDP:          s.captureUDP,
		DriverMode:          s.driverMode,
		MaxBodyPreviewBytes: s.maxBodyPreviewBytes,
		SunnyVersion:        public.SunnyVersion,
		GoVersion:           runtime.Version(),
		GOOS:                runtime.GOOS,
		GOARCH:              runtime.GOARCH,
		BuildStamp:          buildStamp,
		Total:               s.total.Load(),
		Dropped:             s.dropped.Load(),
		QueueDepth:          len(s.queue),
		LastID:              s.nextID.Load(),
		Error:               s.lastError,
		Capabilities:        platformCapabilitiesForRuntime(),
	}
}

func (s *captureService) list(since uint64, limit int, query string, protocol string) map[string]any {
	limit = clamp(limit, 1, maxListLimit)
	query = strings.ToLower(strings.TrimSpace(query))
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	if protocol == "" {
		protocol = "all"
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows := make([]sessionRow, 0, min(limit, len(s.sessions)))
	for i := len(s.sessions) - 1; i >= 0 && len(rows) < limit; i-- {
		item := s.sessions[i]
		if item.ID <= since {
			break
		}
		if protocol != "all" && strings.ToLower(item.Protocol) != protocol {
			continue
		}
		if query != "" && !item.matches(query) {
			continue
		}
		rows = append(rows, item.toRow())
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	return map[string]any{
		"items": rows, "lastId": s.nextID.Load(), "total": s.total.Load(),
		"dropped": s.dropped.Load(), "running": s.running,
	}
}

func (s *captureService) detail(id uint64) (captureEvent, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	index, ok := s.byID[id]
	if !ok || index < 0 || index >= len(s.sessions) {
		return captureEvent{}, false
	}
	return s.sessions[index], true
}

func (s *captureService) enqueue(event captureEvent) {
	event.ID = s.nextID.Add(1)
	now := time.Now().UnixMilli()
	if event.CreatedAt == 0 {
		event.CreatedAt = now
	}
	event.UpdatedAt = now
	select {
	case s.queue <- event:
	default:
		s.dropped.Add(1)
	}
}

func (s *captureService) consumeEvents() {
	ticker := time.NewTicker(publishInterval)
	defer ticker.Stop()
	pending := 0
	for {
		select {
		case event := <-s.queue:
			s.applyEvent(event)
			pending++
			if pending >= 256 {
				s.publishSoon()
				pending = 0
			}
		case <-ticker.C:
			if pending > 0 {
				s.publishSoon()
				pending = 0
			}
		}
	}
}

func (s *captureService) applyEvent(event captureEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.total.Add(1)
	if event.ParentID != 0 {
		if parentIndex, ok := s.byID[event.ParentID]; ok && parentIndex >= 0 && parentIndex < len(s.sessions) {
			mergeEvent(&s.sessions[parentIndex], event)
			return
		}
	}
	item := event
	s.sessions = append(s.sessions, item)
	s.byID[item.ID] = len(s.sessions) - 1
	if len(s.sessions) > maxSessions {
		remove := len(s.sessions) - maxSessions
		for _, old := range s.sessions[:remove] {
			delete(s.byID, old.ID)
		}
		s.sessions = append([]captureEvent(nil), s.sessions[remove:]...)
		s.byID = make(map[uint64]int, len(s.sessions))
		for i := range s.sessions {
			s.byID[s.sessions[i].ID] = i
		}
	}
}

func (s *captureService) publishSoon() {
	s.mu.Lock()
	s.publishSoonLocked()
	s.mu.Unlock()
}

func (s *captureService) publishSoonLocked() {
	if s.publishPending {
		return
	}
	now := time.Now()
	delay := publishInterval - now.Sub(s.lastPublish)
	if delay < 0 {
		delay = 0
	}
	s.publishPending = true
	time.AfterFunc(delay, func() {
		s.mu.Lock()
		s.publishPending = false
		s.lastPublish = time.Now()
		total := s.total.Load()
		dropped := s.dropped.Load()
		lastID := s.nextID.Load()
		running := s.running
		s.mu.Unlock()
		publishEvent(changeEvent, map[string]any{
			"total": total, "dropped": dropped, "lastId": lastID, "running": running,
		})
	})
}

func (s *captureService) onHTTP(conn SunnyNet.ConnHTTP) {
	switch conn.Type() {
	case public.HttpSendRequest:
		event := captureEvent{
			Protocol: "HTTP", Phase: "request", Method: conn.Method(), URL: conn.URL(),
			Proto: conn.Proto(), PID: conn.PID(), Process: conn.GetProcessName(),
			ClientIP: conn.ClientIP(), LocalAddress: conn.LocalAddress(),
			RequestHeader: headerToMap(conn.GetRequestHeader()),
		}
		event.Host, event.Path = splitURL(event.URL)
		body := conn.GetRequestBody()
		event.RequestBytes = len(body)
		event.RequestPreview = previewBody(body, s.maxPreview(), event.RequestHeader)
		s.enqueue(event)
	case public.HttpResponseOK:
		event := captureEvent{
			Protocol: "HTTP", Phase: "response", ParentID: s.findHTTPParent(conn.URL()),
			Method: conn.Method(), URL: conn.URL(), Proto: conn.GetResponseProto(),
			PID: conn.PID(), Process: conn.GetProcessName(), ClientIP: conn.ClientIP(),
			LocalAddress: conn.LocalAddress(), RemoteAddress: conn.ServerAddress(),
			Status: conn.GetResponseCode(), ResponseHeader: headerToMap(conn.GetResponseHeader()),
		}
		event.Host, event.Path = splitURL(event.URL)
		body := conn.GetResponseBody()
		event.ResponseBytes = len(body)
		event.ResponsePreview = previewBody(body, s.maxPreview(), event.ResponseHeader)
		s.enqueue(event)
	case public.HttpRequestFail:
		event := captureEvent{
			Protocol: "HTTP", Phase: "error", ParentID: s.findHTTPParent(conn.URL()),
			Method: conn.Method(), URL: conn.URL(), PID: conn.PID(),
			Process: conn.GetProcessName(), Error: conn.Error(),
		}
		event.Host, event.Path = splitURL(event.URL)
		s.enqueue(event)
	}
}

func (s *captureService) onWS(conn SunnyNet.ConnWebSocket) {
	phase := mapWSPhase(conn.Type())
	if phase == "" {
		return
	}
	body := conn.Body()
	event := captureEvent{
		Protocol: "WS", Phase: phase, Method: conn.Method(), URL: conn.URL(),
		PID: conn.PID(), Process: conn.GetProcessName(), ClientIP: conn.ClientIP(),
		LocalAddress: conn.LocalAddress(), MessageType: conn.MessageType(),
		BodyBytes: conn.BodyLen(), BodyPreview: previewRaw(body, s.maxPreview()),
	}
	event.Host, event.Path = splitURL(event.URL)
	switch conn.Type() {
	case public.WebsocketUserSend:
		event.Direction = "client->server"
	case public.WebsocketServerSend:
		event.Direction = "server->client"
	}
	if len(body) > 0 && len(body) <= s.maxPreview() {
		event.BodyBase64 = base64.StdEncoding.EncodeToString(body)
	}
	s.enqueue(event)
}

func (s *captureService) onTCP(conn SunnyNet.ConnTCP) {
	if !s.captureTCP {
		return
	}
	phase := mapTCPPhase(conn.Type())
	if phase == "" {
		return
	}
	bodyLen := conn.BodyLen()
	event := captureEvent{
		Protocol: "TCP", Phase: phase, PID: conn.PID(), Process: conn.GetProcessName(),
		LocalAddress: conn.LocalAddress(), RemoteAddress: conn.RemoteAddress(),
		BodyBytes: bodyLen,
	}
	switch conn.Type() {
	case public.SunnyNetMsgTypeTCPClientSend:
		event.Direction = "client->server"
		event.BodyPreview = previewRaw(conn.Body(), s.maxPreview())
	case public.SunnyNetMsgTypeTCPClientReceive:
		event.Direction = "server->client"
		event.BodyPreview = previewRaw(conn.Body(), s.maxPreview())
	}
	s.enqueue(event)
}

func (s *captureService) onUDP(conn SunnyNet.ConnUDP) {
	if !s.captureUDP {
		return
	}
	phase := mapUDPPhase(conn.Type())
	if phase == "" {
		return
	}
	body := conn.Body()
	event := captureEvent{
		Protocol: "UDP", Phase: phase, PID: conn.PID(), Process: conn.GetProcessName(),
		LocalAddress: conn.LocalAddress(), RemoteAddress: conn.RemoteAddress(),
		BodyBytes: conn.BodyLen(), BodyPreview: previewRaw(body, s.maxPreview()),
	}
	switch conn.Type() {
	case public.SunnyNetUDPTypeSend:
		event.Direction = "client->server"
	case public.SunnyNetUDPTypeReceive:
		event.Direction = "server->client"
	}
	s.enqueue(event)
}

func (s *captureService) maxPreview() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.maxBodyPreviewBytes
}

func (s *captureService) findHTTPParent(rawURL string) uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for i := len(s.sessions) - 1; i >= 0 && i >= len(s.sessions)-4096; i-- {
		item := s.sessions[i]
		if item.Protocol == "HTTP" && item.Phase == "request" && item.URL == rawURL && item.ParentID == 0 {
			return item.ID
		}
	}
	return 0
}

func mergeEvent(target *captureEvent, next captureEvent) {
	target.Phase = next.Phase
	target.Status = next.Status
	target.Proto = firstNonEmpty(next.Proto, target.Proto)
	target.RemoteAddress = firstNonEmpty(next.RemoteAddress, target.RemoteAddress)
	target.ResponseBytes = next.ResponseBytes
	target.ResponseHeader = next.ResponseHeader
	target.ResponsePreview = next.ResponsePreview
	target.Error = next.Error
	target.UpdatedAt = next.UpdatedAt
	if target.CreatedAt > 0 && next.UpdatedAt > 0 {
		target.DurationMs = next.UpdatedAt - target.CreatedAt
	}
}

func (e captureEvent) toRow() sessionRow {
	return sessionRow{
		ID: e.ID, Protocol: e.Protocol, Phase: e.Phase, Method: e.Method, URL: e.URL,
		Host: e.Host, Path: e.Path, Status: e.Status, PID: e.PID, Process: e.Process,
		Direction: e.Direction, LocalAddress: e.LocalAddress, RemoteAddress: e.RemoteAddress,
		RequestBytes: e.RequestBytes, ResponseBytes: e.ResponseBytes, BodyBytes: e.BodyBytes,
		DurationMs: e.DurationMs, Error: e.Error, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt,
	}
}

func (e captureEvent) matches(query string) bool {
	return strings.Contains(strings.ToLower(e.URL), query) ||
		strings.Contains(strings.ToLower(e.Host), query) ||
		strings.Contains(strings.ToLower(e.Path), query) ||
		strings.Contains(strings.ToLower(e.Process), query) ||
		strings.Contains(strings.ToLower(e.RemoteAddress), query) ||
		strings.Contains(strings.ToLower(e.LocalAddress), query)
}

func headerToMap(header sunnyHTTP.Header) map[string]string {
	out := make(map[string]string, len(header))
	for key, values := range header {
		if len(values) > 0 {
			out[key] = strings.Join(values, "\n")
		}
	}
	return out
}

func previewBody(body []byte, capBytes int, headers map[string]string) string {
	if len(body) == 0 {
		return ""
	}
	contentType := ""
	for key, value := range headers {
		if strings.EqualFold(key, "Content-Type") {
			contentType = value
			break
		}
	}
	if contentType != "" && !looksTextual(contentType) {
		return fmt.Sprintf("<%s · %d bytes>", contentType, len(body))
	}
	return previewRaw(body, capBytes)
}

func previewRaw(body []byte, capBytes int) string {
	if len(body) == 0 {
		return ""
	}
	if len(body) > capBytes {
		body = body[:capBytes]
	}
	if !isMostlyText(body) {
		return base64.StdEncoding.EncodeToString(body)
	}
	return string(body)
}

func isMostlyText(data []byte) bool {
	if len(data) == 0 {
		return true
	}
	bad := 0
	for _, b := range data {
		if b == 0 || b < 9 || (b > 13 && b < 32) {
			bad++
		}
	}
	return bad*100/len(data) < 8
}

func looksTextual(contentType string) bool {
	v := strings.ToLower(contentType)
	return strings.Contains(v, "text/") || strings.Contains(v, "json") ||
		strings.Contains(v, "xml") || strings.Contains(v, "javascript") ||
		strings.Contains(v, "form-urlencoded") || strings.Contains(v, "graphql")
}

func splitURL(raw string) (string, string) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed == nil {
		return "", raw
	}
	path := parsed.EscapedPath()
	if path == "" {
		path = "/"
	}
	if parsed.RawQuery != "" {
		path += "?" + parsed.RawQuery
	}
	return parsed.Host, path
}

func mapWSPhase(t int) string {
	switch t {
	case public.WebsocketConnectionOK:
		return "open"
	case public.WebsocketUserSend:
		return "send"
	case public.WebsocketServerSend:
		return "receive"
	case public.WebsocketDisconnect:
		return "close"
	default:
		return ""
	}
}

func mapTCPPhase(t int) string {
	switch t {
	case public.SunnyNetMsgTypeTCPAboutToConnect:
		return "connect"
	case public.SunnyNetMsgTypeTCPConnectOK:
		return "open"
	case public.SunnyNetMsgTypeTCPClientSend:
		return "send"
	case public.SunnyNetMsgTypeTCPClientReceive:
		return "receive"
	case public.SunnyNetMsgTypeTCPClose:
		return "close"
	default:
		return ""
	}
}

func mapUDPPhase(t int) string {
	switch t {
	case public.SunnyNetUDPTypeSend:
		return "send"
	case public.SunnyNetUDPTypeReceive:
		return "receive"
	case public.SunnyNetUDPTypeClosed:
		return "close"
	default:
		return ""
	}
}

func parseStartOptions(input json.RawMessage) startOptions {
	var value map[string]any
	if len(input) > 0 {
		_ = json.Unmarshal(input, &value)
	}
	return startOptions{
		Port:                toInt(value["port"], defaultPort),
		InstallCert:         toBool(value["installCert"], false),
		SetSystemProxy:      toBool(value["setSystemProxy"], false),
		CaptureTCP:          toBool(value["captureTcp"], true),
		CaptureUDP:          toBool(value["captureUdp"], true),
		MaxBodyPreviewBytes: toInt(value["maxBodyPreviewBytes"], defaultPreviewCap),
		DriverMode:          toString(value["driverMode"], "off"),
		ProcessNames:        toStringList(value["processNames"]),
		ProcessPIDs:         toIntList(value["processPids"]),
		CaptureAllProcesses: toBool(value["captureAllProcesses"], false),
		StopNetworkOnce:     toBool(value["stopNetworkOnce"], false),
	}
}

func parseInput(input json.RawMessage) map[string]any {
	var value map[string]any
	if len(input) > 0 {
		_ = json.Unmarshal(input, &value)
	}
	if value == nil {
		return map[string]any{}
	}
	return value
}

func publishEvent(event string, payload any) {
	if plugin == nil {
		return
	}
	if err := plugin.Events.Publish(event, payload); err != nil {
		plugin.Logf("publish %s failed: %v", event, err)
	}
}

func logf(format string, args ...any) {
	if plugin != nil {
		plugin.Logf(format, args...)
	}
}

func normalizeDriverMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "proxifier", "pr", "0":
		return "proxifier"
	case "nfapi", "1":
		return "nfapi"
	case "tun", "2":
		return "tun"
	default:
		return "off"
	}
}

func driverModeValue(value string) int {
	switch normalizeDriverMode(value) {
	case "proxifier":
		return 0
	case "nfapi":
		return 1
	case "tun":
		return 2
	default:
		return -1
	}
}

func supportsDriverMode(value string) (bool, string) {
	mode := normalizeDriverMode(value)
	if mode == "off" {
		return true, ""
	}
	switch runtime.GOOS {
	case "windows":
		return true, ""
	case "darwin":
		return false, "macOS 当前仅开放系统代理抓包模式，暂不启用 SunnyNet 驱动模式"
	default:
		return false, "当前平台暂不支持 SunnyNet 驱动模式"
	}
}

func platformCapabilitiesForRuntime() platformCapabilities {
	goos := runtime.GOOS
	arch := runtime.GOARCH
	key := platformKey(goos, arch)
	caps := platformCapabilities{
		PlatformKey: key,
		GOOS:        goos,
		GOARCH:      arch,
		SystemProxy: goos == "windows" || goos == "darwin",
		InstallCert: goos == "windows" || goos == "darwin",
		DriverModes: []driverModeCapability{
			{Value: "off", Label: "关闭驱动", Supported: true},
			driverCapability("proxifier", "Proxifier"),
			driverCapability("nfapi", "NFAPI"),
			driverCapability("tun", "TUN"),
		},
	}
	if goos == "darwin" {
		caps.Notes = append(caps.Notes, "macOS 使用系统代理模式抓取 HTTP/HTTPS/WebSocket 流量；SunnyNet 驱动模式暂不开放。")
	}
	return caps
}

func driverCapability(value, label string) driverModeCapability {
	supported, reason := supportsDriverMode(value)
	return driverModeCapability{
		Value:     value,
		Label:     label,
		Supported: supported,
		Reason:    reason,
	}
}

func platformKey(goos string, arch string) string {
	switch goos {
	case "windows":
		if arch == "amd64" {
			return "win-x64"
		}
		if arch == "arm64" {
			return "win-arm64"
		}
	case "darwin":
		if arch == "amd64" {
			return "mac-x64"
		}
		if arch == "arm64" {
			return "mac-arm64"
		}
	case "linux":
		if arch == "amd64" {
			return "linux-x64"
		}
		if arch == "arm64" {
			return "linux-arm64"
		}
	}
	return goos + "-" + arch
}

func installRootCertificate(sunny *SunnyNet.Sunny) string {
	if runtime.GOOS != "darwin" {
		return sunny.InstallCert()
	}
	cert := sunny.ExportCert()
	if len(cert) == 0 {
		return "证书导出失败"
	}
	file, err := os.CreateTemp("", "brickly-sunnynet-*.crt")
	if err != nil {
		return err.Error()
	}
	certPath := file.Name()
	defer func() { _ = os.Remove(certPath) }()
	if _, err := file.Write(cert); err != nil {
		_ = file.Close()
		return err.Error()
	}
	if err := file.Close(); err != nil {
		return err.Error()
	}
	keychain := macLoginKeychainPath()
	args := []string{"add-trusted-cert", "-r", "trustRoot", "-k", keychain, certPath}
	output, err := exec.Command("security", args...).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return "macOS 证书安装失败：" + message
	}
	return ""
}

func macLoginKeychainPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "login.keychain"
	}
	keychain := filepath.Join(home, "Library", "Keychains", "login.keychain-db")
	if _, err := os.Stat(keychain); err == nil {
		return keychain
	}
	return filepath.Join(home, "Library", "Keychains", "login.keychain")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func toInt(v any, def int) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(x))
		if err == nil {
			return n
		}
	}
	return def
}

func toInt64(v any, def int64) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int:
		return int64(x)
	case int64:
		return x
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(x), 10, 64)
		if err == nil {
			return n
		}
	}
	return def
}

func toBool(v any, def bool) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "true", "1", "yes":
			return true
		case "false", "0", "no":
			return false
		}
	}
	return def
}

func toString(v any, def string) string {
	if s, ok := v.(string); ok {
		return s
	}
	return def
}

func toStringList(v any) []string {
	switch x := v.(type) {
	case []any:
		out := make([]string, 0, len(x))
		for _, item := range x {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	case string:
		if strings.TrimSpace(x) == "" {
			return nil
		}
		parts := strings.FieldsFunc(x, func(r rune) bool { return r == ',' || r == ';' || r == '\n' })
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if strings.TrimSpace(part) != "" {
				out = append(out, strings.TrimSpace(part))
			}
		}
		return out
	default:
		return nil
	}
}

func toIntList(v any) []int {
	switch x := v.(type) {
	case []any:
		out := make([]int, 0, len(x))
		for _, item := range x {
			n := toInt(item, 0)
			if n > 0 {
				out = append(out, n)
			}
		}
		return out
	case string:
		if strings.TrimSpace(x) == "" {
			return nil
		}
		parts := strings.FieldsFunc(x, func(r rune) bool { return r == ',' || r == ';' || r == '\n' })
		out := make([]int, 0, len(parts))
		for _, part := range parts {
			n := toInt(part, 0)
			if n > 0 {
				out = append(out, n)
			}
		}
		return out
	default:
		return nil
	}
}

func clamp(v, minValue, maxValue int) int {
	if v < minValue {
		return minValue
	}
	if v > maxValue {
		return maxValue
	}
	return v
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	plugin = brickly.New(brickly.Options{
		BrickID:         brickID,
		ProtocolVersion: protocolVersion,
		Stdout:          stdoutguard.ProtocolStdout(),
	})
	plugin.Logf("started go=%s sunny=%s", runtime.Version(), public.SunnyVersion)

	plugin.OnCommand("start", func(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
		status, err := capture.start(parseStartOptions(input))
		if err != nil {
			return nil, brickly.NewBppError("START_FAILED", err.Error())
		}
		return status, nil
	})
	plugin.OnCommand("stop", func(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
		return capture.stop(), nil
	})
	plugin.OnCommand("status", func(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
		return capture.status(), nil
	})
	plugin.OnCommand("list", func(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
		value := parseInput(input)
		return capture.list(
			uint64(toInt64(value["since"], 0)), toInt(value["limit"], 300),
			toString(value["query"], ""), toString(value["protocol"], "all"),
		), nil
	})
	plugin.OnCommand("detail", func(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
		value := parseInput(input)
		id := uint64(toInt64(value["id"], 0))
		if item, ok := capture.detail(id); ok {
			return map[string]any{"item": item}, nil
		}
		return nil, brickly.NewBppError("NOT_FOUND", "session not found")
	})
	plugin.OnCommand("clear", func(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
		return capture.clear(), nil
	})
	plugin.OnCommand("install-cert", func(_ *brickly.CommandContext, _ json.RawMessage) (any, error) {
		return capture.installCert(), nil
	})
	plugin.OnCommand("set-system-proxy", func(_ *brickly.CommandContext, input json.RawMessage) (any, error) {
		value := parseInput(input)
		result, err := capture.setSystemProxy(toBool(value["enabled"], true))
		if err != nil {
			return nil, brickly.NewBppError("NOT_RUNNING", err.Error())
		}
		return result, nil
	})

	plugin.OnShutdown(func() error {
		capture.stop()
		return nil
	})

	plugin.Start()
}

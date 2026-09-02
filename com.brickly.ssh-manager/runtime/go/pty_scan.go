package main

import (
	"bytes"
	"net/url"
	"strconv"
	"strings"
)

const (
	belByte    byte = 0x07
	stESC      byte = 0x1b
	maxOscHold      = 8192
)

// ptyScanner 从 PTY 字节里抽出启动 PID（OSC 7331）和 cwd（OSC 7），
// 这两类序列不送给终端；其余 OSC / CSI 原样放过。
type ptyScanner struct {
	buf []byte
	pid int
}

type ptyScanResult struct {
	visible []byte
	pid     int
	cwd     string
}

func (s *ptyScanner) push(chunk []byte) ptyScanResult {
	if len(chunk) == 0 && len(s.buf) == 0 {
		return ptyScanResult{}
	}
	s.buf = append(s.buf, chunk...)
	data := s.buf
	var (
		out []byte
		pid int
		cwd string
	)

	for {
		i := bytes.IndexByte(data, 0x1b)
		if i < 0 {
			out = append(out, data...)
			s.buf = nil
			return ptyScanResult{visible: out, pid: pid, cwd: cwd}
		}
		out = append(out, data[:i]...)
		rest := data[i:]
		if len(rest) < 2 {
			s.buf = append([]byte(nil), rest...)
			return ptyScanResult{visible: out, pid: pid, cwd: cwd}
		}
		if rest[1] != ']' {
			out = append(out, rest[0])
			data = rest[1:]
			continue
		}
		body := rest[2:]
		end, termLen := oscTerminator(body)
		if end < 0 {
			if len(rest) > maxOscHold {
				out = append(out, rest...)
				s.buf = nil
				return ptyScanResult{visible: out, pid: pid, cwd: cwd}
			}
			s.buf = append([]byte(nil), rest...)
			return ptyScanResult{visible: out, pid: pid, cwd: cwd}
		}
		payload := body[:end]
		data = body[end+termLen:]
		handled, newPID, newCWD := s.handleOSC(payload)
		if !handled {
			out = append(out, rest[:2+end+termLen]...)
			continue
		}
		if newPID > 0 {
			pid = newPID
		}
		if newCWD != "" {
			cwd = newCWD
		}
	}
}

func (s *ptyScanner) handleOSC(payload []byte) (handled bool, pid int, cwd string) {
	if bytes.HasPrefix(payload, []byte("7331;Pid=")) {
		if s.pid == 0 {
			n, err := strconv.Atoi(string(bytes.TrimSpace(payload[len("7331;Pid="):])))
			if err == nil && n > 0 {
				s.pid = n
				pid = n
			}
		}
		return true, pid, ""
	}
	if bytes.HasPrefix(payload, []byte("7;")) {
		return true, 0, parseOSC7(string(payload[2:]))
	}
	return false, 0, ""
}

func parseOSC7(payload string) string {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return ""
	}
	if strings.HasPrefix(payload, "file://") {
		parsed, err := url.Parse(payload)
		if err != nil {
			return ""
		}
		path := parsed.Path
		if decoded, err := url.PathUnescape(path); err == nil {
			path = decoded
		}
		if validRemoteCwd(path) {
			return path
		}
		return ""
	}
	if validRemoteCwd(payload) {
		return payload
	}
	return ""
}

func oscTerminator(rest []byte) (end, termLen int) {
	bel := bytes.IndexByte(rest, belByte)
	st := bytes.Index(rest, []byte{stESC, '\\'})
	if bel >= 0 && (st < 0 || bel <= st) {
		return bel, 1
	}
	if st >= 0 {
		return st, 2
	}
	return -1, 0
}

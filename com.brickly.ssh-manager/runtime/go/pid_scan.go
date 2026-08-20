package main

import (
	"bytes"
	"strconv"
)

var pidOSCPrefix = []byte("\x1b]7331;Pid=")

const (
	belByte byte = 0x07
	stESC   byte = 0x1b
)

// pidScanner strips the boot OSC that announces the login-shell PID and
// keeps incomplete sequences so they are not shown in the terminal.
type pidScanner struct {
	buf []byte
	pid int
}

func (s *pidScanner) push(chunk []byte) (visible []byte, pid int) {
	if len(chunk) == 0 && len(s.buf) == 0 {
		return nil, 0
	}
	s.buf = append(s.buf, chunk...)
	data := s.buf
	var out []byte

	for {
		i := bytes.Index(data, pidOSCPrefix)
		if i < 0 {
			hold := suffixPrefixLen(data, pidOSCPrefix)
			out = append(out, data[:len(data)-hold]...)
			s.buf = append([]byte(nil), data[len(data)-hold:]...)
			return out, pid
		}
		out = append(out, data[:i]...)
		rest := data[i+len(pidOSCPrefix):]
		end, termLen := oscTerminator(rest)
		if end < 0 {
			s.buf = append([]byte(nil), data[i:]...)
			return out, pid
		}
		if s.pid == 0 {
			n, err := strconv.Atoi(string(bytes.TrimSpace(rest[:end])))
			if err == nil && n > 0 {
				s.pid = n
				pid = n
			}
		}
		data = rest[end+termLen:]
	}
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

func suffixPrefixLen(data, prefix []byte) int {
	max := len(prefix) - 1
	if max > len(data) {
		max = len(data)
	}
	for n := max; n > 0; n-- {
		if bytes.Equal(data[len(data)-n:], prefix[:n]) {
			return n
		}
	}
	return 0
}

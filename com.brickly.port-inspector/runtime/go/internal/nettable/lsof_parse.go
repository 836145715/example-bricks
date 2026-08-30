package nettable

import (
	"bufio"
	"strconv"
	"strings"
)

// parseLsofF parses `lsof -FpcnPTu` style output. Shared for darwin runtime and unit tests.
func parseLsofF(stdout string) []Row {
	var rows []Row
	cur := lsofCur{}
	flush := func() {
		if cur.pid == 0 || cur.name == "" {
			return
		}
		proto := strings.ToLower(cur.protocol)
		if proto != "tcp" && proto != "udp" {
			if strings.Contains(strings.ToUpper(cur.name), "UDP") {
				proto = "udp"
			} else {
				proto = "tcp"
			}
		}
		local, remote, state := parseLsofName(cur.name, cur.state)
		if local.port <= 0 {
			return
		}
		row := Row{
			Protocol:      proto,
			LocalAddress:  local.addr,
			LocalPort:     local.port,
			RemoteAddress: remote.addr,
			State:         state,
			PID:           uint32Ptr(cur.pid),
			ProcessName:   stringPtr(cur.processName),
		}
		if remote.port > 0 {
			row.RemotePort = intPtr(remote.port)
		} else if remote.addr == "*" {
			row.RemotePort = nil
		} else {
			row.RemotePort = intPtr(0)
		}
		rows = append(rows, row)
	}

	sc := bufio.NewScanner(strings.NewReader(stdout))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		tag, val := line[0], line[1:]
		switch tag {
		case 'p':
			flush()
			cur = lsofCur{}
			if n, err := strconv.ParseUint(val, 10, 32); err == nil {
				cur.pid = uint32(n)
			}
		case 'c':
			cur.processName = val
		case 'P':
			cur.protocol = val
		case 'n':
			cur.name = val
		case 'T':
			if strings.HasPrefix(val, "ST=") {
				cur.state = strings.TrimPrefix(val, "ST=")
			}
		}
	}
	flush()
	return rows
}

type lsofCur struct {
	pid         uint32
	processName string
	protocol    string
	name        string
	state       string
}

type endpoint struct {
	addr string
	port int
}

func parseLsofName(name, stateHint string) (local, remote endpoint, state string) {
	state = strings.TrimSpace(stateHint)
	if idx := strings.LastIndex(name, " ("); idx >= 0 && strings.HasSuffix(name, ")") {
		if state == "" {
			state = strings.TrimSuffix(name[idx+2:], ")")
		}
		name = name[:idx]
	}
	parts := strings.SplitN(name, "->", 2)
	local = parseEndpoint(parts[0])
	if len(parts) == 2 {
		remote = parseEndpoint(parts[1])
	} else {
		remote = endpoint{addr: "*", port: 0}
	}
	return local, remote, state
}

func parseEndpoint(value string) endpoint {
	text := strings.TrimSpace(value)
	if text == "" || text == "*" {
		return endpoint{addr: "*", port: 0}
	}
	if strings.HasPrefix(text, "[") {
		end := strings.LastIndex(text, "]")
		if end > 0 {
			addr := text[1:end]
			rest := text[end+1:]
			if strings.HasPrefix(rest, ":") {
				p, _ := strconv.Atoi(rest[1:])
				return endpoint{addr: addr, port: p}
			}
			return endpoint{addr: addr, port: 0}
		}
	}
	last := strings.LastIndex(text, ":")
	if last < 0 {
		return endpoint{addr: text, port: 0}
	}
	addr := text[:last]
	portStr := text[last+1:]
	if portStr == "*" {
		return endpoint{addr: addr, port: 0}
	}
	p, err := strconv.Atoi(portStr)
	if err != nil {
		return endpoint{addr: text, port: 0}
	}
	if addr == "" {
		addr = "*"
	}
	return endpoint{addr: addr, port: p}
}

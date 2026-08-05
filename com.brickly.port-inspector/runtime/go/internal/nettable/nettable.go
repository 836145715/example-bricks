package nettable

import (
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrUnsupported = errors.New("port table unsupported on this platform")
	ErrInvalid     = errors.New("invalid nettable input")
)

type Row struct {
	Protocol       string  `json:"protocol"`
	LocalAddress   string  `json:"localAddress"`
	LocalPort      int     `json:"localPort"`
	RemoteAddress  string  `json:"remoteAddress"`
	RemotePort     *int    `json:"remotePort"`
	State          string  `json:"state"`
	PID            *uint32 `json:"pid"`
	ProcessName    *string `json:"processName"`
	ExecutablePath *string `json:"executablePath"`
}

type QueryResult struct {
	Platform    string `json:"platform"`
	Protocol    string `json:"protocol"`
	Query       string `json:"query"`
	Count       int    `json:"count"`
	GeneratedAt string `json:"generatedAt"`
	Rows        []Row  `json:"rows"`
	Method      string `json:"method"`
}

type Filter struct {
	Port               *int
	Protocol           string // all|tcp|udp
	IncludeEstablished bool
	Query              string
	Limit              int
}

func List(filter Filter) (QueryResult, error) {
	if filter.Limit <= 0 {
		filter.Limit = 300
	}
	if filter.Limit > 2000 {
		filter.Limit = 2000
	}
	proto := strings.ToLower(strings.TrimSpace(filter.Protocol))
	if proto == "" {
		proto = "all"
	}
	if proto != "all" && proto != "tcp" && proto != "udp" {
		return QueryResult{}, ErrInvalid
	}
	filter.Protocol = proto

	rows, method, err := listPlatform()
	if err != nil {
		return QueryResult{}, err
	}
	filtered := applyFilter(rows, filter)
	return QueryResult{
		Platform:    platformName(),
		Protocol:    filter.Protocol,
		Query:       strings.TrimSpace(filter.Query),
		Count:       len(filtered),
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Rows:        filtered,
		Method:      method,
	}, nil
}

func applyFilter(rows []Row, filter Filter) []Row {
	query := strings.ToLower(strings.TrimSpace(filter.Query))
	out := make([]Row, 0, len(rows))
	for _, row := range rows {
		if filter.Protocol != "all" && row.Protocol != filter.Protocol {
			continue
		}
		if filter.Port != nil && row.LocalPort != *filter.Port {
			continue
		}
		if !filter.IncludeEstablished {
			state := strings.ToUpper(row.State)
			if state != "" && state != "LISTEN" && state != "LISTENING" {
				continue
			}
		}
		if query != "" && !rowMatchesQuery(row, query) {
			continue
		}
		out = append(out, row)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].LocalPort != out[j].LocalPort {
			return out[i].LocalPort < out[j].LocalPort
		}
		if out[i].Protocol != out[j].Protocol {
			return out[i].Protocol < out[j].Protocol
		}
		pi, pj := uint32(0), uint32(0)
		if out[i].PID != nil {
			pi = *out[i].PID
		}
		if out[j].PID != nil {
			pj = *out[j].PID
		}
		return pi < pj
	})
	if len(out) > filter.Limit {
		out = out[:filter.Limit]
	}
	return out
}

func rowMatchesQuery(row Row, query string) bool {
	parts := []string{
		row.Protocol,
		row.LocalAddress,
		strconv.Itoa(row.LocalPort),
		row.RemoteAddress,
		row.State,
	}
	if row.RemotePort != nil {
		parts = append(parts, strconv.Itoa(*row.RemotePort))
	}
	if row.PID != nil {
		parts = append(parts, strconv.FormatUint(uint64(*row.PID), 10))
	}
	if row.ProcessName != nil {
		parts = append(parts, *row.ProcessName)
	}
	if row.ExecutablePath != nil {
		parts = append(parts, *row.ExecutablePath)
	}
	return strings.Contains(strings.ToLower(strings.Join(parts, " ")), query)
}

func intPtr(v int) *int {
	return &v
}

func uint32Ptr(v uint32) *uint32 {
	if v == 0 {
		return nil
	}
	return &v
}

func stringPtr(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}

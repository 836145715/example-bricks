package nettable

import (
	"testing"
)

func TestApplyFilterPortAndProtocol(t *testing.T) {
	port3000 := 3000
	rows := []Row{
		{Protocol: "tcp", LocalAddress: "127.0.0.1", LocalPort: 3000, State: "LISTEN", PID: uint32Ptr(11)},
		{Protocol: "tcp", LocalAddress: "127.0.0.1", LocalPort: 3000, State: "ESTABLISHED", PID: uint32Ptr(11)},
		{Protocol: "udp", LocalAddress: "0.0.0.0", LocalPort: 5353, State: "", PID: uint32Ptr(22)},
		{Protocol: "tcp", LocalAddress: "0.0.0.0", LocalPort: 8080, State: "LISTEN", PID: uint32Ptr(33)},
	}

	filtered := applyFilter(rows, Filter{
		Port:               &port3000,
		Protocol:           "tcp",
		IncludeEstablished: true,
		Limit:              100,
	})
	if len(filtered) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(filtered))
	}

	listenOnly := applyFilter(rows, Filter{
		Protocol:           "all",
		IncludeEstablished: false,
		Limit:              100,
	})
	// LISTEN tcp + empty-state udp
	if len(listenOnly) != 3 {
		t.Fatalf("expected 3 listen-ish rows, got %d", len(listenOnly))
	}
}

func TestApplyFilterQuery(t *testing.T) {
	rows := []Row{
		{Protocol: "tcp", LocalAddress: "127.0.0.1", LocalPort: 5173, State: "LISTEN", PID: uint32Ptr(99), ProcessName: stringPtr("node")},
	}
	filtered := applyFilter(rows, Filter{
		Protocol:           "all",
		IncludeEstablished: true,
		Query:              "node",
		Limit:              10,
	})
	if len(filtered) != 1 {
		t.Fatalf("expected query hit, got %d", len(filtered))
	}
	miss := applyFilter(rows, Filter{
		Protocol:           "all",
		IncludeEstablished: true,
		Query:              "python",
		Limit:              10,
	})
	if len(miss) != 0 {
		t.Fatalf("expected no hits, got %d", len(miss))
	}
}

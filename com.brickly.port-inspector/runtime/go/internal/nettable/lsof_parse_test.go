package nettable

import "testing"

func TestParseLsofF(t *testing.T) {
	raw := "" +
		"p12345\n" +
		"cnode\n" +
		"PTCP\n" +
		"n127.0.0.1:5173\n" +
		"TST=LISTEN\n" +
		"p888\n" +
		"cavahi-daemon\n" +
		"PUDP\n" +
		"n*:5353\n"

	rows := parseLsofF(raw)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d: %+v", len(rows), rows)
	}
	if rows[0].Protocol != "tcp" || rows[0].LocalPort != 5173 || rows[0].State != "LISTEN" {
		t.Fatalf("tcp row: %+v", rows[0])
	}
	if rows[0].PID == nil || *rows[0].PID != 12345 {
		t.Fatalf("tcp pid: %+v", rows[0].PID)
	}
	if rows[0].ProcessName == nil || *rows[0].ProcessName != "node" {
		t.Fatalf("tcp name: %+v", rows[0].ProcessName)
	}
	if rows[1].Protocol != "udp" || rows[1].LocalPort != 5353 {
		t.Fatalf("udp row: %+v", rows[1])
	}
}

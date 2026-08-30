//go:build darwin

package nettable

import (
	"fmt"
	"os/exec"
	"strconv"

	"brickly/port-inspector/internal/procinfo"
)

func platformName() string { return "macos" }

// listPlatform uses lsof structured fields (-F) for CGO-free reliability on macOS.
func listPlatform() ([]Row, string, error) {
	cmd := exec.Command("lsof", "-nP", "-iTCP", "-iUDP", "-FpcnPTu")
	out, err := cmd.Output()
	if err != nil {
		// lsof exits 1 when no matches; still may have partial stdout
		if len(out) == 0 {
			if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
				return []Row{}, "lsof", nil
			}
			return nil, "", fmt.Errorf("%w: lsof: %v", ErrUnsupported, err)
		}
	}
	rows := parseLsofF(string(out))
	cache := map[uint32]procinfo.Snapshot{}
	for i := range rows {
		if rows[i].PID == nil {
			continue
		}
		pid := *rows[i].PID
		snap, ok := cache[pid]
		if !ok {
			snap = procinfo.SnapshotOf(pid)
			cache[pid] = snap
		}
		if snap.ProcessName != "" && rows[i].ProcessName == nil {
			rows[i].ProcessName = stringPtr(snap.ProcessName)
		}
		if snap.ExecutablePath != "" {
			rows[i].ExecutablePath = stringPtr(snap.ExecutablePath)
		}
	}
	return dedupeDarwin(rows), "lsof", nil
}

func dedupeDarwin(rows []Row) []Row {
	seen := map[string]struct{}{}
	out := make([]Row, 0, len(rows))
	for _, row := range rows {
		if row.LocalPort <= 0 {
			continue
		}
		rp := ""
		if row.RemotePort != nil {
			rp = strconv.Itoa(*row.RemotePort)
		}
		pid := ""
		if row.PID != nil {
			pid = strconv.FormatUint(uint64(*row.PID), 10)
		}
		key := row.Protocol + "|" + row.LocalAddress + "|" + strconv.Itoa(row.LocalPort) + "|" + row.RemoteAddress + "|" + rp + "|" + row.State + "|" + pid
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, row)
	}
	return out
}

//go:build windows

package nettable

import (
	"encoding/binary"
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"unsafe"

	"brickly/port-inspector/internal/procinfo"
	"golang.org/x/sys/windows"
)

const (
	tcpTableOwnerPIDAll = 5
	udpTableOwnerPID    = 1
	afINET              = 2
	afINET6             = 23
)

var (
	modIphlpapi              = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable  = modIphlpapi.NewProc("GetExtendedTcpTable")
	procGetExtendedUdpTable  = modIphlpapi.NewProc("GetExtendedUdpTable")
)

type mibTCPRowOwnerPID struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32
	RemoteAddr uint32
	RemotePort uint32
	OwningPid  uint32
}

type mibTCP6RowOwnerPID struct {
	LocalAddr     [16]byte
	LocalScopeId  uint32
	LocalPort     uint32
	RemoteAddr    [16]byte
	RemoteScopeId uint32
	RemotePort    uint32
	State         uint32
	OwningPid     uint32
}

type mibUDPRowOwnerPID struct {
	LocalAddr uint32
	LocalPort uint32
	OwningPid uint32
}

type mibUDP6RowOwnerPID struct {
	LocalAddr    [16]byte
	LocalScopeId uint32
	LocalPort    uint32
	OwningPid    uint32
}

func platformName() string { return "windows" }

func listPlatform() ([]Row, string, error) {
	var rows []Row
	tcp4, err := readTCP(afINET)
	if err != nil {
		return nil, "", err
	}
	rows = append(rows, tcp4...)
	tcp6, err := readTCP(afINET6)
	if err != nil {
		return nil, "", err
	}
	rows = append(rows, tcp6...)
	udp4, err := readUDP(afINET)
	if err != nil {
		return nil, "", err
	}
	rows = append(rows, udp4...)
	udp6, err := readUDP(afINET6)
	if err != nil {
		return nil, "", err
	}
	rows = append(rows, udp6...)

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
		if snap.ProcessName != "" {
			rows[i].ProcessName = stringPtr(snap.ProcessName)
		}
		if snap.ExecutablePath != "" {
			rows[i].ExecutablePath = stringPtr(snap.ExecutablePath)
		}
	}
	return dedupe(rows), "api", nil
}

func readTCP(family uint32) ([]Row, error) {
	buf, err := queryTable(procGetExtendedTcpTable, family, tcpTableOwnerPIDAll)
	if err != nil {
		return nil, err
	}
	if len(buf) < 4 {
		return nil, nil
	}
	count := binary.LittleEndian.Uint32(buf[:4])
	offset := 4
	rows := make([]Row, 0, count)
	if family == afINET {
		size := int(unsafe.Sizeof(mibTCPRowOwnerPID{}))
		for i := uint32(0); i < count; i++ {
			if offset+size > len(buf) {
				break
			}
			row := (*mibTCPRowOwnerPID)(unsafe.Pointer(&buf[offset]))
			offset += size
			lp := ntohsPort(row.LocalPort)
			rp := ntohsPort(row.RemotePort)
			rows = append(rows, Row{
				Protocol:      "tcp",
				LocalAddress:  ipv4String(row.LocalAddr),
				LocalPort:     lp,
				RemoteAddress: ipv4String(row.RemoteAddr),
				RemotePort:    intPtr(rp),
				State:         tcpStateName(row.State),
				PID:           uint32Ptr(row.OwningPid),
			})
		}
		return rows, nil
	}
	size := int(unsafe.Sizeof(mibTCP6RowOwnerPID{}))
	for i := uint32(0); i < count; i++ {
		if offset+size > len(buf) {
			break
		}
		row := (*mibTCP6RowOwnerPID)(unsafe.Pointer(&buf[offset]))
		offset += size
		lp := ntohsPort(row.LocalPort)
		rp := ntohsPort(row.RemotePort)
		rows = append(rows, Row{
			Protocol:      "tcp",
			LocalAddress:  ipv6String(row.LocalAddr[:]),
			LocalPort:     lp,
			RemoteAddress: ipv6String(row.RemoteAddr[:]),
			RemotePort:    intPtr(rp),
			State:         tcpStateName(row.State),
			PID:           uint32Ptr(row.OwningPid),
		})
	}
	return rows, nil
}

func readUDP(family uint32) ([]Row, error) {
	buf, err := queryTable(procGetExtendedUdpTable, family, udpTableOwnerPID)
	if err != nil {
		return nil, err
	}
	if len(buf) < 4 {
		return nil, nil
	}
	count := binary.LittleEndian.Uint32(buf[:4])
	offset := 4
	rows := make([]Row, 0, count)
	if family == afINET {
		size := int(unsafe.Sizeof(mibUDPRowOwnerPID{}))
		for i := uint32(0); i < count; i++ {
			if offset+size > len(buf) {
				break
			}
			row := (*mibUDPRowOwnerPID)(unsafe.Pointer(&buf[offset]))
			offset += size
			rows = append(rows, Row{
				Protocol:      "udp",
				LocalAddress:  ipv4String(row.LocalAddr),
				LocalPort:     ntohsPort(row.LocalPort),
				RemoteAddress: "*",
				RemotePort:    nil,
				State:         "",
				PID:           uint32Ptr(row.OwningPid),
			})
		}
		return rows, nil
	}
	size := int(unsafe.Sizeof(mibUDP6RowOwnerPID{}))
	for i := uint32(0); i < count; i++ {
		if offset+size > len(buf) {
			break
		}
		row := (*mibUDP6RowOwnerPID)(unsafe.Pointer(&buf[offset]))
		offset += size
		rows = append(rows, Row{
			Protocol:      "udp",
			LocalAddress:  ipv6String(row.LocalAddr[:]),
			LocalPort:     ntohsPort(row.LocalPort),
			RemoteAddress: "*",
			RemotePort:    nil,
			State:         "",
			PID:           uint32Ptr(row.OwningPid),
		})
	}
	return rows, nil
}

func queryTable(proc *windows.LazyProc, family, class uint32) ([]byte, error) {
	var size uint32
	r0, _, _ := proc.Call(0, uintptr(unsafe.Pointer(&size)), 0, uintptr(family), uintptr(class), 0)
	if windows.Errno(r0) != windows.ERROR_INSUFFICIENT_BUFFER && r0 != 0 {
		// First call often returns ERROR_INSUFFICIENT_BUFFER with size.
		if size == 0 {
			return nil, fmt.Errorf("query table size failed: %w", windows.Errno(r0))
		}
	}
	for attempt := 0; attempt < 3; attempt++ {
		buf := make([]byte, size)
		r0, _, _ = proc.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0, uintptr(family), uintptr(class), 0)
		if r0 == 0 {
			return buf, nil
		}
		if windows.Errno(r0) != windows.ERROR_INSUFFICIENT_BUFFER {
			return nil, fmt.Errorf("query table failed: %w", windows.Errno(r0))
		}
	}
	return nil, fmt.Errorf("query table failed: buffer grow loop")
}

func ntohsPort(v uint32) int {
	// Port is stored in network byte order in the low 16 bits.
	p := uint16(v & 0xffff)
	return int((p>>8)&0xff | (p&0xff)<<8)
}

func ipv4String(addr uint32) string {
	b := [4]byte{byte(addr), byte(addr >> 8), byte(addr >> 16), byte(addr >> 24)}
	return net.IP(b[:]).String()
}

func ipv6String(b []byte) string {
	ip := net.IP(b)
	if ip.IsUnspecified() {
		return "::"
	}
	return ip.String()
}

func tcpStateName(state uint32) string {
	switch state {
	case 1:
		return "CLOSED"
	case 2:
		return "LISTEN"
	case 3:
		return "SYN_SENT"
	case 4:
		return "SYN_RCVD"
	case 5:
		return "ESTABLISHED"
	case 6:
		return "FIN_WAIT1"
	case 7:
		return "FIN_WAIT2"
	case 8:
		return "CLOSE_WAIT"
	case 9:
		return "CLOSING"
	case 10:
		return "LAST_ACK"
	case 11:
		return "TIME_WAIT"
	case 12:
		return "DELETE_TCB"
	default:
		return "STATE_" + strconv.FormatUint(uint64(state), 10)
	}
}

func dedupe(rows []Row) []Row {
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
		// Prefer basename process name already filled by SnapshotOf.
		if row.ProcessName != nil {
			base := filepath.Base(*row.ProcessName)
			row.ProcessName = stringPtr(base)
		}
		out = append(out, row)
	}
	return out
}

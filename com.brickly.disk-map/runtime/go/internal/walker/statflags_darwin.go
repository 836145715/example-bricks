//go:build darwin

package walker

import "syscall"

// statFlags 读 st_flags（UF_*/SF_* 位）。仅 darwin 有该字段。
func statFlags(st *syscall.Stat_t) uint32 {
	return st.Flags
}

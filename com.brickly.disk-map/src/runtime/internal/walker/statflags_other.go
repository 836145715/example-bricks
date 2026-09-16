//go:build !darwin

package walker

import "syscall"

func statFlags(*syscall.Stat_t) uint32 { return 0 }

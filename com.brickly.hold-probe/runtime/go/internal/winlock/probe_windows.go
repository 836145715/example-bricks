//go:build windows

package winlock

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"time"
)

func logf(format string, args ...any) {
	// stdout is reserved for BPP; diagnostics go to stderr.
	_, _ = fmt.Fprintf(os.Stderr, "[hold-probe] "+format+"\n", args...)
}

func Probe(path string, kind string, deep bool) (Result, error) {
	// Overall budget so the UI never spins forever.
	budget := 12 * time.Second
	if deep {
		budget = 20 * time.Second
	}
	result, err := runWithTimeout(budget, func() (Result, error) {
		return probeOnce(path, kind, deep)
	})
	if err != nil {
		logf("probe failed path=%s deep=%v err=%v", path, deep, err)
		return Result{}, err
	}
	logf("probe done path=%s kind=%s count=%d deep=%v", path, kind, result.Count, result.DeepUsed)
	return result, nil
}

func probeOnce(path string, kind string, deep bool) (Result, error) {
	notes := []string{}
	merged := map[uint32]Holder{}
	started := time.Now()

	// 1) Restart Manager — strong for open files; often weak/denied for directories.
	logf("stage=rm start")
	rmHolders, rmErr := runWithTimeout(4*time.Second, func() ([]Holder, error) {
		return probeRestartManager(path)
	})
	if rmErr != nil {
		if errors.Is(rmErr, ErrAccess) {
			notes = append(notes, "Restart Manager 无权读取该路径的占用列表（目录场景常见）。")
		} else if errors.Is(rmErr, ErrProbe) && containsTimeout(rmErr) {
			notes = append(notes, "Restart Manager 超时，已跳过。")
		} else {
			notes = append(notes, fmt.Sprintf("Restart Manager: %v", rmErr))
		}
		logf("stage=rm err=%v", rmErr)
	} else {
		mergeHolders(merged, rmHolders)
		logf("stage=rm ok count=%d", len(rmHolders))
	}

	// 2) Process reference scan — image / command line / cwd via Win32.
	logf("stage=process-ref start")
	refHolders, refErr := runWithTimeout(8*time.Second, func() ([]Holder, error) {
		return probeProcessRefs(path)
	})
	if refErr != nil {
		notes = append(notes, fmt.Sprintf("进程引用扫描: %v", refErr))
		logf("stage=process-ref err=%v", refErr)
	} else {
		mergeHolders(merged, refHolders)
		if kind == "directory" && len(refHolders) > 0 {
			notes = append(notes, "已通过进程命令行/路径引用匹配到占用者（目录场景）。")
		}
		logf("stage=process-ref ok count=%d", len(refHolders))
	}

	// 3) Handle scan — optional deep path, hard-capped.
	deepUsed := false
	if deep {
		deepUsed = true
		logf("stage=handles start")
		handleHolders, hErr := runWithTimeout(10*time.Second, func() ([]Holder, error) {
			return probeHandles(path)
		})
		if hErr != nil {
			notes = append(notes, fmt.Sprintf("句柄扫描: %v", hErr))
			logf("stage=handles err=%v", hErr)
		} else {
			mergeHolders(merged, handleHolders)
			if len(handleHolders) == 0 {
				notes = append(notes, "句柄扫描未发现匹配的打开句柄（可能权限不足或扫描超时）。")
			}
			logf("stage=handles ok count=%d", len(handleHolders))
		}
	} else if kind == "directory" && len(merged) == 0 {
		notes = append(notes, "若仍无法删除目录，可勾选「深度扫描」做句柄枚举。")
	}

	holders := make([]Holder, 0, len(merged))
	for _, h := range merged {
		holders = append(holders, h)
	}
	sort.Slice(holders, func(i, j int) bool {
		if holders[i].ProcessName == holders[j].ProcessName {
			return holders[i].PID < holders[j].PID
		}
		return holders[i].ProcessName < holders[j].ProcessName
	})

	if len(holders) == 0 && rmErr != nil && !deepUsed && kind != "directory" && len(refHolders) == 0 && !containsTimeout(rmErr) {
		return Result{}, rmErr
	}

	logf("probeOnce elapsed=%s holders=%d", time.Since(started), len(holders))
	return Result{
		Path:     path,
		Kind:     kind,
		Count:    len(holders),
		Holders:  holders,
		DeepUsed: deepUsed,
		Notes:    notes,
		ProbedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func containsTimeout(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, ErrProbe) && (stringContains(err.Error(), "timed out") || stringContains(err.Error(), "timeout"))
}

func stringContains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})())
}

func mergeHolders(dst map[uint32]Holder, src []Holder) {
	for _, h := range src {
		if existing, ok := dst[h.PID]; ok {
			existing.Sources = mergeSources(existing.Sources, h.Sources)
			if existing.ProcessName == "" {
				existing.ProcessName = h.ProcessName
			}
			if existing.StartKey == "" || existing.StartKey == "0" {
				existing.StartKey = h.StartKey
				existing.StartedAt = h.StartedAt
			}
			if existing.ApplicationType == "" || existing.ApplicationType == "unknown" {
				existing.ApplicationType = h.ApplicationType
			}
			dst[h.PID] = existing
		} else {
			dst[h.PID] = h
		}
	}
}

func mergeSources(a, b []Source) []Source {
	seen := map[Source]bool{}
	out := make([]Source, 0, len(a)+len(b))
	for _, s := range append(a, b...) {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

//go:build darwin

// Package volume 读取卷用量与本地快照列表，全部只读：Statfs + diskutil info -plist + tmutil listlocalsnapshots。
package volume

import (
	"os/exec"
	"strings"

	"golang.org/x/sys/unix"
)

// Info 是 volume 命令的返回结构。
type Info struct {
	Path           string   `json:"path"` // 挂载点
	Device         string   `json:"device"`
	TotalBytes     int64    `json:"totalBytes"`
	FreeBytes      int64    `json:"freeBytes"`
	AvailableBytes int64    `json:"availableBytes"`
	PurgeableBytes *int64   `json:"purgeableBytes"` // diskutil 尽力解析，拿不到就 null
	Snapshots      []string `json:"snapshots"`
	SnapshotsError string   `json:"snapshotsError,omitempty"`
}

// Statfs 读取路径所在卷的基础用量。
func Statfs(path string) (Info, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return Info{}, err
	}
	bs := int64(st.Bsize)
	return Info{
		Path:           cString(st.Mntonname[:]),
		Device:         cString(st.Mntfromname[:]),
		TotalBytes:     int64(st.Blocks) * bs,
		FreeBytes:      int64(st.Bfree) * bs,
		AvailableBytes: int64(st.Bavail) * bs,
	}, nil
}

func cString(b []byte) string {
	if i := strings.IndexByte(string(b), 0); i >= 0 {
		return string(b[:i])
	}
	return string(b)
}

// Runner 执行外部只读命令（diskutil / tmutil）。生产实现走 exec.Command；测试可注入。
type Runner interface {
	Output(name string, args ...string) ([]byte, error)
}

// RealRunner 是生产实现。
type RealRunner struct{}

func (RealRunner) Output(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

// Enrich 用 diskutil / tmutil 补充 Purgeable 与快照列表，失败不致命。
func Enrich(info Info, runner Runner) Info {
	if out, err := runner.Output("diskutil", "info", "-plist", info.Path); err == nil {
		if purgeable, ok := LookupPurgeable(out); ok {
			info.PurgeableBytes = &purgeable
		}
	}
	info.Snapshots = []string{}
	if out, err := runner.Output("tmutil", "listlocalsnapshots", info.Path); err == nil {
		info.Snapshots = ParseSnapshots(string(out))
	} else {
		info.SnapshotsError = "无法读取本地快照列表：" + firstLine(err.Error())
	}
	return info
}

// Query 一步到位：Statfs + Enrich。
func Query(path string, runner Runner) (Info, error) {
	info, err := Statfs(path)
	if err != nil {
		return Info{}, err
	}
	return Enrich(info, runner), nil
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// Package recipe 探测白名单固定路径的磁盘大户。只探测，不删除；
// node_modules 由扫描过程发现后并入结果。
package recipe

import (
	"os"
	"path/filepath"
	"strings"
)

// Item 是一条 recipe 命中。
type Item struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Path   string `json:"path"`
	Kind   string `json:"kind"` // dir | file
	Exists bool   `json:"exists"`
	// Bytes 只有普通文件才有（如 Docker.raw）；目录大小等扫完后从树里读。
	Bytes  *int64 `json:"bytes"`
	InRoot bool   `json:"inRoot"` // 在当前扫描根之下，可直接跳转/回收
}

type candidate struct {
	id    string
	label string
	rel   string // 相对家目录
	kind  string
}

// candidates 是白名单。node_modules 不在这里 —— 它由扫盘发现。
var candidates = []candidate{
	{"xcode-derived-data", "Xcode DerivedData", "Library/Developer/Xcode/DerivedData", "dir"},
	{"core-simulator", "iOS 模拟器数据", "Library/Developer/CoreSimulator", "dir"},
	{"docker-raw", "Docker 磁盘镜像 (Docker.raw)", "Library/Containers/com.docker.docker/Data/vms/0/Docker.raw", "file"},
	{"docker-qcow2", "Docker 磁盘镜像 (Docker.qcow2)", "Library/Containers/com.docker.docker/Data/vms/Docker.qcow2", "file"},
	{"wechat", "微信数据", "Library/Containers/com.tencent.xinWeChat", "dir"},
	{"telegram", "Telegram 数据", "Library/Containers/ru.keepcoder.Telegram", "dir"},
	{"caches", "用户缓存 (~/Library/Caches)", "Library/Caches", "dir"},
}

// Stat 给出单个路径的存在性与大小（文件）。
type Stat func(path string) (exists bool, size int64, isDir bool)

// LstatStat 是生产实现。
func LstatStat(path string) (bool, int64, bool) {
	st, err := os.Lstat(path)
	if err != nil {
		return false, 0, false
	}
	return true, st.Size(), st.IsDir()
}

// Probe 返回所有白名单条目（存在与否都返回，前端只展示命中的）。
func Probe(home, root string, stat Stat) []Item {
	items := make([]Item, 0, len(candidates))
	for _, c := range candidates {
		path := filepath.Join(home, filepath.FromSlash(c.rel))
		exists, size, isDir := stat(path)
		kind := c.kind
		if exists && isDir {
			kind = "dir"
		} else if exists {
			kind = "file"
		}
		var bytes *int64
		if exists && kind == "file" {
			s := size
			bytes = &s
		}
		items = append(items, Item{
			ID:     c.id,
			Label:  c.label,
			Path:   path,
			Kind:   kind,
			Exists: exists,
			Bytes:  bytes,
			InRoot: root != "" && under(path, root),
		})
	}
	return items
}

// Extra 把扫描发现的路徑（如 node_modules）包装成 Item。
func Extra(id, label, path, root string, stat Stat) Item {
	exists, _, isDir := stat(path)
	kind := "dir"
	if exists && !isDir {
		kind = "file"
	}
	return Item{
		ID:     id,
		Label:  label,
		Path:   path,
		Kind:   kind,
		Exists: exists,
		InRoot: root != "" && under(path, root),
	}
}

func under(path, base string) bool {
	if base == "" {
		return false
	}
	base = filepath.Clean(base)
	if base == "/" {
		return true
	}
	rel, err := filepath.Rel(base, path)
	if err != nil {
		return false
	}
	if rel == ".." || rel == "." || rel == "" {
		return false
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

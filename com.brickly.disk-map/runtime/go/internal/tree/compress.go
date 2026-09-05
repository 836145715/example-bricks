package tree

import (
	"path/filepath"
	"sort"
	"time"

	"com.brickly.disk-map/internal/model"
)

// StoredNode 是压缩缓存里的一个目录。
type StoredNode struct {
	Path           string          `json:"path"`
	Name           string          `json:"name"`
	AllocatedBytes int64           `json:"allocatedBytes"`
	LogicalBytes   int64           `json:"logicalBytes"`
	FileCount      int64           `json:"fileCount"`
	DirCount       int64           `json:"dirCount"`
	Complete       bool            `json:"complete"`
	Flags          model.NodeFlags `json:"flags"`
}

// StoredScan 是 last-scan KV 的整体结构。
type StoredScan struct {
	Root     string          `json:"root"`
	SavedAt  int64           `json:"savedAt"`
	Nodes    []StoredNode    `json:"nodes"`
	ExtStats []model.ExtStat `json:"extStats,omitempty"`
}

// Compress 导出深度 ≤ maxDepth 且 allocated ≥ minBytes 的目录，
// keepPaths 里的路径无条件保留（recipe 命中）。文件摘要不进缓存，extStats 由调用方传入。
func (t *Tree) Compress(maxDepth int, minBytes int64, keepPaths map[string]bool, extStats []model.ExtStat) StoredScan {
	t.mu.RLock()
	defer t.mu.RUnlock()

	out := StoredScan{Root: t.root, SavedAt: time.Now().Unix(), ExtStats: extStats}
	paths := make([]string, 0, len(t.nodes))
	for p := range t.nodes {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		n := t.nodes[p]
		if !n.complete || n.placeholder {
			continue
		}
		keep := keepPaths[p]
		if !keep {
			if n.depth > maxDepth {
				continue
			}
			if n.allocated < minBytes {
				continue
			}
		}
		out.Nodes = append(out.Nodes, StoredNode{
			Path:           n.path,
			Name:           n.name,
			AllocatedBytes: n.allocated,
			LogicalBytes:   n.logical,
			FileCount:      n.fileCount,
			DirCount:       n.dirCount,
			Complete:       n.complete,
			Flags:          n.flags,
		})
	}
	return out
}

// Restore 用压缩快照重建一棵只读树（节点完整但无孩子摘要）。
func Restore(stored StoredScan) *Tree {
	t := New(stored.Root)
	t.mu.Lock()
	defer t.mu.Unlock()
	// 先按路径排序，保证父节点先于子节点存在。
	nodes := append([]StoredNode{}, stored.Nodes...)
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Path < nodes[j].Path })
	for _, sn := range nodes {
		parent := filepath.Dir(sn.Path)
		if sn.Path == t.root {
			rootNode := t.nodes[t.root]
			rootNode.allocated = sn.AllocatedBytes
			rootNode.logical = sn.LogicalBytes
			rootNode.fileCount = sn.FileCount
			rootNode.dirCount = sn.DirCount
			rootNode.complete = sn.Complete
			rootNode.flags = sn.Flags
			continue
		}
		// 路径已排序，父节点一定先处理；父链断掉的条目不装回。
		if _, ok := t.nodes[parent]; !ok && parent != t.root {
			continue
		}
		t.nodes[sn.Path] = &node{
			path:      sn.Path,
			name:      sn.Name,
			parent:    parent,
			depth:     depthOf(sn.Path, t.root),
			allocated: sn.AllocatedBytes,
			logical:   sn.LogicalBytes,
			fileCount: sn.FileCount,
			dirCount:  sn.DirCount,
			complete:  sn.Complete,
			flags:     sn.Flags,
		}
	}
	// 重建父节点的子目录列表。
	for _, sn := range nodes {
		if sn.Path == t.root {
			continue
		}
		if p, ok := t.nodes[filepath.Dir(sn.Path)]; ok {
			p.dirName = append(p.dirName, sn.Name)
		}
	}
	return t
}

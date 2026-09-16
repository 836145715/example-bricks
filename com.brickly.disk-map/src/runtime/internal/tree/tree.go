// Package tree 维护带锁的内存目录树。只保存目录节点 + 每层 top-N 文件摘要，
// 聚合数字来自子条目的增量上报，支持 peek 快照、删除回收与压缩缓存。
package tree

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"com.brickly.disk-map/internal/model"
	"com.brickly.disk-map/internal/walker"
)

// maxFileChildren 每个目录保留的文件摘要上限（供列表/旭日图展示）。
const maxFileChildren = 64

// fileRec 是一个文件/符号链接/特殊文件的紧凑摘要。
type fileRec struct {
	Name         string
	Alloc        int64
	Logical      int64
	Kind         model.NodeKind
	Protected    bool
	Dataless     bool
	Inaccessible bool
}

type node struct {
	path    string
	name    string
	parent  string
	depth   int      // 相对根，根为 0
	dirName []string // 直接子目录名（按发现序）

	// 聚合：子树口径（含自身以下的文件与目录，不含目录自身的 inode 块）。
	allocated int64
	logical   int64
	fileCount int64
	dirCount  int64

	complete bool
	// placeholder 表示节点由后代条目先建出来，自身的目录条目还没到达（DirCount 未上卷）。
	placeholder bool
	// aggregateOnly 为 true（node_modules/.git 等巨叶）时不记录孩子层。
	aggregateOnly bool

	// direct flags（目录自身的状态）
	flags model.NodeFlags

	files []fileRec // 直接文件摘要，allocated 降序，最多 maxFileChildren
}

type Tree struct {
	mu    sync.RWMutex
	root  string
	nodes map[string]*node
}

// New 创建只含根节点的树。
func New(root string) *Tree {
	root = filepath.Clean(root)
	t := &Tree{root: root, nodes: map[string]*node{}}
	t.nodes[root] = &node{
		path:  root,
		name:  filepath.Base(root),
		depth: 0,
		flags: model.NodeFlags{Kind: model.KindDir},
	}
	return t
}

func (t *Tree) Root() string { return t.root }

// Apply 吸收 walker 的一条观察。对同一文件的重复上报做差量校正（回退重扫时幂等）。
func (t *Tree) Apply(e walker.Entry) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if e.Flags.Inaccessible && e.Flags.Kind == model.KindDir {
		if n, ok := t.nodes[e.Path]; ok {
			n.flags.Inaccessible = true
			return
		}
		// 兜底：正常流程里父目录条目会先建好节点。
		n := &node{
			path:   e.Path,
			name:   e.Name,
			parent: filepath.Dir(e.Path),
			depth:  e.Depth,
			flags:  model.NodeFlags{Kind: model.KindDir, Inaccessible: true},
		}
		t.nodes[e.Path] = n
		if p, ok := t.nodes[n.parent]; ok {
			p.dirName = append(p.dirName, n.name)
		}
		return
	}

	// 巨叶内部：并入最近的 aggregate-only 祖先，不建节点。
	if anchor := t.findAggregateAncestor(filepath.Dir(e.Path)); anchor != "" {
		t.applyDeltaLocked(anchor, e.Allocated, e.Logical, e.FileCount, e.DirCount)
		return
	}

	if e.Flags.Kind == model.KindDir {
		t.applyDirEntry(e)
		return
	}
	t.applyFileEntry(e)
}

// applyDirEntry 记录一个目录条目。条目只带 DirCount=1 和 flags，大小来自孩子增量。
func (t *Tree) applyDirEntry(e walker.Entry) {
	n, ok := t.nodes[e.Path]
	if !ok {
		n = &node{
			path:   e.Path,
			name:   e.Name,
			parent: filepath.Dir(e.Path),
			depth:  e.Depth,
		}
		n.flags = e.Flags
		n.aggregateOnly = e.AggregateOnly
		t.nodes[e.Path] = n
		t.attachDirLocked(n, e.DirCount)
		return
	}
	// 占位节点被真实条目追认，或重复条目（回退重扫）。
	n.flags = e.Flags
	n.aggregateOnly = n.aggregateOnly || e.AggregateOnly
	if !n.placeholder {
		return // DirCount 已经上过卷
	}
	n.placeholder = false
	t.attachDirLocked(n, e.DirCount)
}

// attachDirLocked 把 DirCount 上卷到祖先（目录不计自身）并把目录挂进父节点的子目录列表。
func (t *Tree) attachDirLocked(n *node, dirCount int64) {
	t.applyUpLocked(filepath.Dir(n.path), 0, 0, 0, dirCount)
	if p, ok := t.nodes[n.parent]; ok {
		p.dirName = append(p.dirName, n.name)
	}
}

// applyFileEntry 记录文件/链接/特殊文件：更新父目录的摘要列表并上卷增量。
func (t *Tree) applyFileEntry(e walker.Entry) {
	rec := fileRec{
		Name:      e.Name,
		Alloc:     e.Allocated,
		Logical:   e.Logical,
		Kind:      e.Flags.Kind,
		Protected: e.Flags.Protected,
		Dataless:  e.Flags.Dataless,
	}
	parent := filepath.Dir(e.Path)
	p, ok := t.nodes[parent]
	if !ok {
		// 直接父节点缺失：建占位（walker 正常流程里父条目总是先到，
		// 这里只为乱序输入兜底）。
		p = &node{
			path:        parent,
			name:        filepath.Base(parent),
			parent:      filepath.Dir(parent),
			depth:       depthOf(parent, t.root),
			placeholder: true,
			flags:       model.NodeFlags{Kind: model.KindDir},
		}
		t.nodes[parent] = p
	}
	deltaAlloc, deltaLogical := rec.Alloc, rec.Logical
	// 差量校正：同名记录已存在则替换。
	replaced := false
	for i := range p.files {
		if p.files[i].Name == rec.Name {
			deltaAlloc -= p.files[i].Alloc
			deltaLogical -= p.files[i].Logical
			p.files[i] = rec
			replaced = true
			break
		}
	}
	if !replaced {
		p.files = insertFileRec(p.files, rec)
	} else {
		sort.SliceStable(p.files, func(i, j int) bool { return p.files[i].Alloc > p.files[j].Alloc })
	}
	count := int64(1)
	if rec.Kind == model.KindLink || rec.Kind == model.KindOther {
		count = 0 // fileCount 只数普通文件
	}
	t.applyUpLocked(parent, deltaAlloc, deltaLogical, count, 0)
}

// insertFileRec 插入并保持 allocated 降序，超容量丢弃最小的（其字节数仍计入聚合）。
func insertFileRec(list []fileRec, rec fileRec) []fileRec {
	pos := sort.Search(len(list), func(i int) bool { return list[i].Alloc < rec.Alloc })
	list = append(list, fileRec{})
	copy(list[pos+1:], list[pos:])
	list[pos] = rec
	if len(list) > maxFileChildren {
		return list[:maxFileChildren]
	}
	return list
}

// findAggregateAncestor 从 path 向上找最近的 aggregate-only 节点；只在已有节点中查，不建占位。
func (t *Tree) findAggregateAncestor(path string) string {
	for path != t.root && path != "/" && path != "." {
		if n, ok := t.nodes[path]; ok && n.aggregateOnly {
			return path
		}
		path = filepath.Dir(path)
	}
	return ""
}

// applyDeltaLocked 把增量记在 anchor 自身并继续向上（巨叶内部条目用）。
func (t *Tree) applyDeltaLocked(anchor string, alloc, logical, files, dirs int64) {
	t.applyUpLocked(anchor, alloc, logical, files, dirs)
}

// applyUpLocked 把增量加到 from 自身并沿父链一路加到根（含根）。
// 父链缺节点时创建占位目录；越过扫描根直接截断（防御幽灵节点）。
func (t *Tree) applyUpLocked(from string, alloc, logical, files, dirs int64) {
	for {
		if !t.inRootLocked(from) {
			return
		}
		n, ok := t.nodes[from]
		if !ok {
			n = &node{
				path:        from,
				name:        filepath.Base(from),
				parent:      filepath.Dir(from),
				depth:       depthOf(from, t.root),
				placeholder: true,
				flags:       model.NodeFlags{Kind: model.KindDir},
			}
			t.nodes[from] = n
		}
		n.allocated += alloc
		n.logical += logical
		n.fileCount += files
		n.dirCount += dirs
		if from == t.root {
			return
		}
		parent := filepath.Dir(from)
		if parent == from {
			return // 到文件系统根了
		}
		from = parent
	}
}

// inRootLocked 判断路径是否在扫描根之内（含根）。
func (t *Tree) inRootLocked(path string) bool {
	if path == t.root {
		return true
	}
	if t.root == "/" {
		return strings.HasPrefix(path, "/")
	}
	return strings.HasPrefix(path, t.root+"/")
}

func depthOf(path, root string) int {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return 0
	}
	return strings.Count(rel, string(filepath.Separator)) + 1
}

// CompleteDir 标记目录子树扫描完成。
func (t *Tree) CompleteDir(path string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if n, ok := t.nodes[path]; ok {
		n.complete = true
	}
}

// Node 构造某路径的 TreeNode 快照：摘要 + 直接孩子（allocated 降序，
// 相对父节点 <1.5% 或超出 64 个的合并成「其他」桶）。
func (t *Tree) Node(path string) (model.TreeNode, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	n, ok := t.nodes[filepath.Clean(path)]
	if !ok {
		return model.TreeNode{}, false
	}
	return t.snapshotLocked(n), true
}

// Summary 返回节点摘要（不含孩子），供 scan 会话的发射门槛做轻量查询。
func (t *Tree) Summary(path string) (model.NodeSummary, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	n, ok := t.nodes[filepath.Clean(path)]
	if !ok {
		return model.NodeSummary{}, false
	}
	return n.summary(), true
}

// FlagsFor 返回路径的观察标志：目录查节点，文件/链接查父目录的文件摘要。
// trash 保护校验用；树里没有的路径返回 false（调用方按零值标志放行，仍受前缀锁约束）。
func (t *Tree) FlagsFor(path string) (model.NodeFlags, bool) {
	path = filepath.Clean(path)
	t.mu.RLock()
	defer t.mu.RUnlock()
	if n, ok := t.nodes[path]; ok {
		return n.flags, true
	}
	parent := filepath.Dir(path)
	if p, ok := t.nodes[parent]; ok {
		for i := range p.files {
			if joinPath(parent, p.files[i].Name) == path {
				f := p.files[i]
				return model.NodeFlags{
					Kind:         f.Kind,
					Protected:    f.Protected,
					Inaccessible: f.Inaccessible,
					Dataless:     f.Dataless,
				}, true
			}
		}
	}
	return model.NodeFlags{}, false
}

// summary 生成节点摘要（调用方需持锁）。
func (n *node) summary() model.NodeSummary {
	return model.NodeSummary{
		Path:           n.path,
		Name:           n.name,
		AllocatedBytes: n.allocated,
		LogicalBytes:   n.logical,
		FileCount:      n.fileCount,
		DirCount:       n.dirCount,
		ChildCount:     n.fileCount + n.dirCount,
		Complete:       n.complete,
		Flags:          n.flags,
	}
}

func (t *Tree) snapshotLocked(n *node) model.TreeNode {
	out := model.TreeNode{
		NodeSummary: n.summary(),
		Children:    []model.NodeSummary{},
	}
	if n.aggregateOnly {
		// 巨叶（node_modules/.git 等）：聚合数字已并入，内部不展开给 UI。
		return out
	}

	type child struct {
		summary model.NodeSummary
		isDir   bool
	}
	var kids []child
	for _, name := range n.dirName {
		cn, ok := t.nodes[joinPath(n.path, name)]
		if !ok {
			continue
		}
		kids = append(kids, child{
			summary: model.NodeSummary{
				Path:           cn.path,
				Name:           cn.name,
				AllocatedBytes: cn.allocated,
				LogicalBytes:   cn.logical,
				FileCount:      cn.fileCount,
				DirCount:       cn.dirCount,
				ChildCount:     cn.fileCount + cn.dirCount,
				Complete:       cn.complete,
				Flags:          cn.flags,
			},
			isDir: true,
		})
	}
	for _, f := range n.files {
		kids = append(kids, child{
			summary: model.NodeSummary{
				Path:           joinPath(n.path, f.Name),
				Name:           f.Name,
				AllocatedBytes: f.Alloc,
				LogicalBytes:   f.Logical,
				Complete:       true,
				Flags: model.NodeFlags{
					Kind:      f.Kind,
					Protected: f.Protected,
					Dataless:  f.Dataless,
				},
			},
		})
	}
	sort.SliceStable(kids, func(i, j int) bool {
		return kids[i].summary.AllocatedBytes > kids[j].summary.AllocatedBytes
	})

	threshold := n.allocated * 3 / 200 // 1.5%
	listedAlloc, listedLogical := int64(0), int64(0)
	listedDirs, listedFiles := 0, 0
	for _, k := range kids {
		if len(out.Children) >= maxFileChildren {
			break
		}
		if k.summary.AllocatedBytes < threshold && len(out.Children) > 0 {
			break // 已列入的都更大；剩下的都进 Other
		}
		if k.isDir {
			listedDirs++
		} else {
			listedFiles++
		}
		listedAlloc += k.summary.AllocatedBytes
		listedLogical += k.summary.LogicalBytes
		out.Children = append(out.Children, k.summary)
	}

	otherCount := n.fileCount + n.dirCount - int64(listedDirs) - int64(listedFiles)
	otherAlloc := n.allocated - listedAlloc
	if otherCount > 0 && otherAlloc > 0 {
		out.Children = append(out.Children, model.NodeSummary{
			Name:           model.OtherName,
			AllocatedBytes: otherAlloc,
			LogicalBytes:   n.logical - listedLogical,
			ChildCount:     otherCount,
			Complete:       true,
			Flags:          model.NodeFlags{Kind: model.KindOther},
		})
	}
	return out
}

func joinPath(parent, name string) string {
	if parent == "/" {
		return "/" + name
	}
	return parent + "/" + name
}

// Remove 把一个已回收的路径从树里减掉（目录连子树一起），并向上回卷负增量。
// 返回 false 表示树里没有这个路径（巨叶内部节点或未扫描到）。
func (t *Tree) Remove(path string) bool {
	path = filepath.Clean(path)
	t.mu.Lock()
	defer t.mu.Unlock()
	n, ok := t.nodes[path]
	if !ok {
		// 可能是文件：从父目录摘要里减。
		parent := filepath.Dir(path)
		p, ok := t.nodes[parent]
		if !ok {
			return false
		}
		for i := range p.files {
			if joinPath(parent, p.files[i].Name) == path {
				rec := p.files[i]
				count := int64(1)
				if rec.Kind == model.KindLink || rec.Kind == model.KindOther {
					count = 0
				}
				p.files = append(p.files[:i], p.files[i+1:]...)
				t.applyUpLocked(parent, -rec.Alloc, -rec.Logical, -count, 0)
				return true
			}
		}
		return false
	}
	if path == t.root {
		return false // 根不允许删
	}
	t.applyUpLocked(path, -n.allocated, -n.logical, -n.fileCount, -n.dirCount)
	// 从父目录的子目录列表摘除。
	parent := filepath.Dir(path)
	if p, ok := t.nodes[parent]; ok {
		for i, name := range p.dirName {
			if joinPath(parent, name) == path {
				p.dirName = append(p.dirName[:i], p.dirName[i+1:]...)
				break
			}
		}
	}
	t.removeSubtreeLocked(path)
	return true
}

func (t *Tree) removeSubtreeLocked(path string) {
	n, ok := t.nodes[path]
	if !ok {
		return
	}
	for _, name := range n.dirName {
		t.removeSubtreeLocked(joinPath(path, name))
	}
	delete(t.nodes, path)
}

// InaccessibleCount 统计打不开的目录数量（UI 提示完全磁盘访问用）。
func (t *Tree) InaccessibleCount() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	count := 0
	for _, n := range t.nodes {
		if n.flags.Inaccessible {
			count++
		}
	}
	return count
}

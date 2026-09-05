package tree

import (
	"path/filepath"
	"testing"

	"com.brickly.disk-map/internal/model"
	"com.brickly.disk-map/internal/walker"
)

func entry(path string, kind model.NodeKind, alloc, logical int64) walker.Entry {
	return walker.Entry{
		Path:  path,
		Name:  filepath.Base(path),
		Depth: 1,
		Flags: model.NodeFlags{Kind: kind},
	}
}

func dirEntry(path string, depth int, aggregateOnly bool) walker.Entry {
	e := walker.Entry{
		Path:          path,
		Name:          filepath.Base(path),
		Depth:         depth,
		Flags:         model.NodeFlags{Kind: model.KindDir},
		DirCount:      1,
		Descend:       true,
		AggregateOnly: aggregateOnly,
	}
	return e
}

func fileEntry(path string, depth int, alloc, logical int64) walker.Entry {
	return walker.Entry{
		Path:      path,
		Name:      filepath.Base(path),
		Depth:     depth,
		Flags:     model.NodeFlags{Kind: model.KindFile},
		Allocated: alloc,
		Logical:   logical,
		FileCount: 1,
	}
}

func TestTreeAggregation(t *testing.T) {
	tr := New("/root")
	// 目录先到（父扫描时发现），然后孩子陆续上报。
	tr.Apply(dirEntry("/root/a", 1, false))
	tr.Apply(fileEntry("/root/a/f1.bin", 2, 1000, 1200))
	tr.Apply(fileEntry("/root/a/f2.bin", 2, 500, 600))
	tr.Apply(dirEntry("/root/a/sub", 2, false))
	tr.Apply(fileEntry("/root/a/sub/f3.bin", 3, 250, 260))
	tr.CompleteDir("/root/a/sub")
	tr.CompleteDir("/root/a")
	tr.CompleteDir("/root")

	node, ok := tr.Node("/root/a")
	if !ok {
		t.Fatal("a missing")
	}
	if node.AllocatedBytes != 1750 {
		t.Errorf("a allocated = %d, want 1750", node.AllocatedBytes)
	}
	if node.LogicalBytes != 2060 {
		t.Errorf("a logical = %d, want 2060", node.LogicalBytes)
	}
	if node.FileCount != 3 {
		t.Errorf("a fileCount = %d, want 3", node.FileCount)
	}
	if node.DirCount != 1 {
		t.Errorf("a dirCount = %d, want 1", node.DirCount)
	}
	if !node.Complete {
		t.Errorf("a should be complete")
	}

	root, _ := tr.Node("/root")
	if root.AllocatedBytes != 1750 {
		t.Errorf("root allocated = %d, want 1750", root.AllocatedBytes)
	}
	// 孩子按 allocated 降序。
	if len(root.Children) < 1 || root.Children[0].Name != "a" {
		t.Fatalf("root children = %+v", root.Children)
	}
	// a 之下：文件摘要 + sub 目录。
	a := node
	if len(a.Children) != 3 {
		t.Fatalf("a children = %d, want 3 (f1,f2,sub)", len(a.Children))
	}
	if a.Children[0].Name != "f1.bin" || a.Children[0].AllocatedBytes != 1000 {
		t.Errorf("first child = %+v", a.Children[0])
	}
	if a.Children[2].Name != "sub" || a.Children[2].ChildCount != 1 {
		t.Errorf("sub child = %+v", a.Children[2])
	}
}

func TestTreePlaceholderOrderIndependence(t *testing.T) {
	// 并发扫描下，孩子的条目可能先于目录自身的条目到达。
	tr := New("/root")
	tr.Apply(fileEntry("/root/deep/inner/f.bin", 3, 4096, 4096))
	// 此时 /root/deep 与 /root/deep/inner 是占位目录。
	n, ok := tr.Node("/root/deep")
	if !ok {
		t.Fatal("placeholder deep missing")
	}
	if n.AllocatedBytes != 4096 {
		t.Errorf("deep allocated = %d", n.AllocatedBytes)
	}
	// 真实条目后到：挂进父列表。
	tr.Apply(dirEntry("/root/deep", 1, false))
	tr.Apply(dirEntry("/root/deep/inner", 2, false))
	n, _ = tr.Node("/root")
	if len(n.Children) == 0 || n.Children[0].Name != "deep" {
		t.Fatalf("root children after late dir entry = %+v", n.Children)
	}
	if n.DirCount != 2 { // deep + inner
		t.Errorf("root dirCount = %d, want 2", n.DirCount)
	}
}

func TestTreeOtherBucketAndThreshold(t *testing.T) {
	tr := New("/root")
	tr.Apply(dirEntry("/root/big", 1, false))
	// 10 个小文件，每个占 1%（<1.5% 阈值）→ 全部合并进「其他」。
	for i := 0; i < 10; i++ {
		tr.Apply(fileEntry("/root/big/tiny"+string(rune('a'+i)), 2, 10, 10))
	}
	// 一个大文件。
	tr.Apply(fileEntry("/root/big/huge.bin", 2, 10000, 10000))
	tr.Apply(dirEntry("/root/big", 1, false))
	tr.CompleteDir("/root/big")

	node, _ := tr.Node("/root/big")
	if len(node.Children) != 2 {
		t.Fatalf("children = %d, want 2 (huge + 其他)", len(node.Children))
	}
	if node.Children[0].Name != "huge.bin" {
		t.Errorf("first child = %s", node.Children[0].Name)
	}
	other := node.Children[1]
	if other.Name != model.OtherName || other.Flags.Kind != model.KindOther {
		t.Errorf("other = %+v", other)
	}
	if other.AllocatedBytes != 100 {
		t.Errorf("other allocated = %d, want 100", other.AllocatedBytes)
	}
	if other.ChildCount != 10 {
		t.Errorf("other childCount = %d, want 10", other.ChildCount)
	}
	if node.Children[0].Path == "" {
		t.Errorf("real children must carry paths")
	}
	if other.Path != "" {
		t.Errorf("other bucket path should be empty")
	}
}

func TestTreeGiantLeafFold(t *testing.T) {
	tr := New("/root")
	tr.Apply(dirEntry("/root/node_modules", 1, true))
	// 巨叶内部的条目：不建节点，全部并入巨叶聚合。
	tr.Apply(dirEntry("/root/node_modules/pkg", 2, false))
	tr.Apply(fileEntry("/root/node_modules/pkg/index.js", 3, 700, 900))
	tr.Apply(fileEntry("/root/node_modules/loose.js", 2, 100, 100))
	tr.CompleteDir("/root/node_modules")
	tr.CompleteDir("/root")

	nm, ok := tr.Node("/root/node_modules")
	if !ok {
		t.Fatal("node_modules node missing")
	}
	if nm.AllocatedBytes != 800 {
		t.Errorf("node_modules allocated = %d, want 800", nm.AllocatedBytes)
	}
	if nm.FileCount != 2 || nm.DirCount != 1 {
		t.Errorf("node_modules counts = %d files / %d dirs, want 2/1", nm.FileCount, nm.DirCount)
	}
	if len(nm.Children) != 0 {
		t.Errorf("node_modules should not expose children, got %d", len(nm.Children))
	}
	if _, ok := tr.Node("/root/node_modules/pkg"); ok {
		t.Errorf("inner dir should not be a node")
	}
	root, _ := tr.Node("/root")
	if root.AllocatedBytes != 800 {
		t.Errorf("root allocated = %d, want 800", root.AllocatedBytes)
	}
	// 子树口径：node_modules 自身与内部的 pkg 都算根的目录。
	if root.DirCount != 2 {
		t.Errorf("root dirCount = %d, want 2", root.DirCount)
	}
	// 根的孩子列表里只出现 node_modules 一层。
	if len(root.Children) != 1 || root.Children[0].Name != "node_modules" {
		t.Errorf("root children = %+v", root.Children)
	}
}

func TestTreeRemoveDirAndFile(t *testing.T) {
	tr := New("/root")
	tr.Apply(dirEntry("/root/a", 1, false))
	tr.Apply(fileEntry("/root/a/f1.bin", 2, 1000, 1000))
	tr.Apply(dirEntry("/root/a/sub", 2, false))
	tr.Apply(fileEntry("/root/a/sub/f2.bin", 3, 500, 500))
	tr.Apply(fileEntry("/root/top.bin", 1, 2000, 2000))
	tr.CompleteDir("/root/a")
	tr.CompleteDir("/root")

	if !tr.Remove("/root/a") {
		t.Fatal("remove dir failed")
	}
	root, _ := tr.Node("/root")
	if root.AllocatedBytes != 2000 {
		t.Errorf("root allocated after remove = %d, want 2000", root.AllocatedBytes)
	}
	if root.FileCount != 1 {
		t.Errorf("root fileCount after remove = %d, want 1", root.FileCount)
	}
	for _, c := range root.Children {
		if c.Name == "a" {
			t.Errorf("a should be gone from children")
		}
	}
	if _, ok := tr.Node("/root/a/sub"); ok {
		t.Errorf("subtree should be removed")
	}
	if !tr.Remove("/root/top.bin") {
		t.Fatal("remove file failed")
	}
	root, _ = tr.Node("/root")
	if root.AllocatedBytes != 0 || root.FileCount != 0 {
		t.Errorf("root after file remove = %+v", root.NodeSummary)
	}
	if tr.Remove("/root") {
		t.Errorf("removing root must be refused")
	}
}

func TestTreeInaccessible(t *testing.T) {
	tr := New("/root")
	tr.Apply(dirEntry("/root/locked", 1, false))
	locked := walker.Entry{
		Path:       "/root/locked",
		Name:       "locked",
		ParentPath: "/root",
		Depth:      1,
		Flags:      model.NodeFlags{Kind: model.KindDir, Inaccessible: true},
	}
	tr.Apply(locked)
	if tr.InaccessibleCount() != 1 {
		t.Errorf("InaccessibleCount = %d, want 1", tr.InaccessibleCount())
	}
	n, _ := tr.Node("/root/locked")
	if !n.Flags.Inaccessible {
		t.Errorf("flag lost")
	}
}

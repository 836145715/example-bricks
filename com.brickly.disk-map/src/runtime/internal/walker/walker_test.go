package walker

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// collect 吸收 walker 的输出供断言（worker 并发回调，需要锁）。
type collect struct {
	mu      sync.Mutex
	entries map[string]Entry
	done    map[string]int
	hits    []string
}

func newCollect() *collect {
	return &collect{entries: map[string]Entry{}, done: map[string]int{}}
}

func (c *collect) sink() Sink {
	return Sink{
		OnEntry: func(e Entry) {
			c.mu.Lock()
			c.entries[e.Path] = e
			c.mu.Unlock()
		},
		OnDirDone: func(path string, depth int) {
			c.mu.Lock()
			c.done[path] = depth
			c.mu.Unlock()
		},
		OnRecipeHit: func(path string) {
			c.mu.Lock()
			c.hits = append(c.hits, path)
			c.mu.Unlock()
		},
	}
}

func TestWalkTempTree(t *testing.T) {
	root := t.TempDir()
	write := func(rel, content string) {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("a/big1.txt", "0123456789ABCDEF") // ≥1 block
	write("a/big2.txt", "0123456789ABCDEF")
	write("b/sub/deep.txt", "x")
	write("top.txt", "y")
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	c := newCollect()
	stats, err := Walk(context.Background(), Options{
		Root:          root,
		ProgressEvery: 150 * time.Millisecond,
		Sink:          c.sink(),
	})
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	if got := c.entries[root+"/a"].Flags.Kind; got != kindDir {
		t.Errorf("a kind = %v", got)
	}
	if got := c.entries[root+"/a/big1.txt"].Flags.Kind; got != kindFile {
		t.Errorf("big1 kind = %v", got)
	}
	if c.entries[root+"/a/big1.txt"].Allocated <= 0 {
		t.Errorf("big1 allocated = %d, want > 0", c.entries[root+"/a/big1.txt"].Allocated)
	}
	if c.entries[root+"/b/sub"].Depth != 2 {
		t.Errorf("b/sub depth = %d, want 2", c.entries[root+"/b/sub"].Depth)
	}
	if c.entries[root+"/b/sub"].ParentPath != root+"/b" {
		t.Errorf("b/sub parent = %q", c.entries[root+"/b/sub"].ParentPath)
	}
	// 所有目录都要完成。
	for _, dir := range []string{root, root + "/a", root + "/b", root + "/b/sub", root + "/empty"} {
		if _, ok := c.done[dir]; !ok {
			t.Errorf("dir %s not completed", dir)
		}
	}
	if c.done[root] != 0 {
		t.Errorf("root depth = %d, want 0", c.done[root])
	}
	if stats.ScannedFiles != 4 {
		t.Errorf("ScannedFiles = %d, want 4", stats.ScannedFiles)
	}
	if stats.ScannedBytes <= 0 {
		t.Errorf("ScannedBytes = %d, want > 0", stats.ScannedBytes)
	}
}

func TestWalkSkipsSymlinkAndSkippedPaths(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 符号链接：不跟随。
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	// 跳过名单：root/junk 整棵不出现。
	junk := filepath.Join(root, "junk")
	if err := os.MkdirAll(junk, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(junk, "x.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "keep.txt"), []byte("k"), 0o644); err != nil {
		t.Fatal(err)
	}

	c := newCollect()
	_, err := Walk(context.Background(), Options{Root: root, Skip: []string{junk}, Sink: c.sink()})
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	if _, ok := c.entries[junk]; ok {
		t.Errorf("skipped dir was emitted")
	}
	link := c.entries[root+"/link.txt"]
	if link.Flags.Kind != kindLink {
		t.Errorf("link kind = %v, want link", link.Flags.Kind)
	}
	if link.Allocated != 0 || link.Logical != 0 {
		t.Errorf("link sizes = %d/%d, want 0/0", link.Allocated, link.Logical)
	}
	if c.entries[root+"/keep.txt"].Flags.Kind != kindFile {
		t.Errorf("keep.txt missing")
	}
}

func TestWalkHardlinkCountedOnce(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "data.bin")
	if err := os.WriteFile(target, make([]byte, 8192), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(target, filepath.Join(root, "alias.bin")); err != nil {
		t.Fatal(err)
	}

	c := newCollect()
	stats, err := Walk(context.Background(), Options{Root: root, Sink: c.sink()})
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	// 两个硬链接都出现，但只有一个计入占用（先扫到哪个不确定）。
	dataAlloc := c.entries[root+"/data.bin"].Allocated
	aliasAlloc := c.entries[root+"/alias.bin"].Allocated
	nonzero := 0
	for _, s := range []int64{dataAlloc, aliasAlloc} {
		if s > 0 {
			nonzero++
		}
	}
	if nonzero != 1 {
		t.Errorf("exactly one hardlink should carry bytes, got data=%d alias=%d", dataAlloc, aliasAlloc)
	}
	if stats.ScannedFiles != 2 {
		t.Errorf("ScannedFiles = %d, want 2 (both entries exist)", stats.ScannedFiles)
	}
}

func TestWalkGiantLeafNotExpanded(t *testing.T) {
	root := t.TempDir()
	nm := filepath.Join(root, "node_modules", "pkg")
	if err := os.MkdirAll(nm, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nm, "index.js"), []byte("// big"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app.js"), []byte("app"), 0o644); err != nil {
		t.Fatal(err)
	}

	c := newCollect()
	_, err := Walk(context.Background(), Options{Root: root, Sink: c.sink()})
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	nmEntry := c.entries[root+"/node_modules"]
	if !nmEntry.AggregateOnly {
		t.Errorf("node_modules should be aggregate-only")
	}
	// walker 层面：巨叶内部条目照常产出；是否建节点由 tree 折叠决定。
	if _, ok := c.entries[root+"/node_modules/pkg"]; !ok {
		t.Errorf("inner dir should still be walked")
	}
	if len(c.hits) != 1 || c.hits[0] != root+"/node_modules" {
		t.Errorf("recipe hits = %v, want [node_modules path]", c.hits)
	}
}

func TestWalkInaccessibleDir(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root can read anything")
	}
	root := t.TempDir()
	locked := filepath.Join(root, "locked")
	if err := os.MkdirAll(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(locked, 0o755)
	if err := os.WriteFile(filepath.Join(root, "ok.txt"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}

	c := newCollect()
	_, err := Walk(context.Background(), Options{Root: root, Sink: c.sink()})
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	lockedEntry := c.entries[locked]
	if !lockedEntry.Flags.Inaccessible {
		t.Errorf("locked dir should be inaccessible, got %+v", lockedEntry.Flags)
	}
	if _, ok := c.done[locked]; !ok {
		t.Errorf("locked dir should still complete")
	}
	if c.entries[root+"/ok.txt"].Flags.Kind != kindFile {
		t.Errorf("scan should continue past inaccessible dir")
	}
}

func TestWalkCancel(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 20; i++ {
		dir := filepath.Join(root, string(rune('a'+i)))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("data"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c := newCollect()
	stats, err := Walk(ctx, Options{Root: root, Sink: c.sink()})
	if err != context.Canceled {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	_ = stats
}

func TestWalkRootErrors(t *testing.T) {
	if _, err := Walk(context.Background(), Options{Root: "", Sink: Sink{}}); err != errEmptyRoot {
		t.Errorf("empty root err = %v", err)
	}
	if _, err := Walk(context.Background(), Options{Root: "relative/path", Sink: Sink{}}); err != errRelativeRoot {
		t.Errorf("relative root err = %v", err)
	}
	if _, err := Walk(context.Background(), Options{Root: "/definitely/not/here", Sink: Sink{}}); err == nil {
		t.Errorf("missing root should error")
	}
}

func TestIsSkipped(t *testing.T) {
	cases := []struct {
		path  string
		extra []string
		want  bool
	}{
		{"/System/Library", nil, true},
		{"/Systemd", nil, false}, // 前缀不能误伤兄弟目录
		{"/usr/bin", nil, true},
		{"/Users/xuan/.Trash", []string{"/Users/xuan/.Trash"}, true},
		{"/Users/xuan/Desktop", []string{"/Users/xuan/.Trash"}, false},
	}
	for _, c := range cases {
		if got := isSkipped(c.path, c.extra); got != c.want {
			t.Errorf("isSkipped(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

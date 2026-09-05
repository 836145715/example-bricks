package scan

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"com.brickly.disk-map/internal/model"
)

func TestSessionGatesAndDone(t *testing.T) {
	root := t.TempDir()
	mk := func(rel string, size int) {
		path := filepath.Join(root, rel)
		os.MkdirAll(filepath.Dir(path), 0o755)
		os.WriteFile(path, make([]byte, size), 0o644)
	}
	mk("big/big.bin", 9<<20)     // 深度 1 → 发 node
	mk("big/deep/x.bin", 9<<20)  // 深度 2、≥8MiB → 发 node
	mk("tiny/shallow/y.txt", 10) // 深度 2、<8MiB → 不发
	mk("tiny/f.txt", 10)         // 深度 2 文件
	mk("top.bin", 100)           // 根下的文件

	s := New(root)
	var events []Event
	emit := func(ev Event) error {
		events = append(events, ev)
		return nil
	}
	result, err := s.Start(context.Background(), StartOptions{Root: root, Emit: emit})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !result.Completed {
		t.Errorf("result not completed: %+v", result)
	}

	nodePaths := map[string]bool{}
	hasDone := false
	for _, ev := range events {
		switch ev.Type {
		case "progress":
		case "node":
			nodePaths[ev.Node.Path] = true
		case "done":
			hasDone = true
			if ev.Done.Root != root {
				t.Errorf("done root = %s", ev.Done.Root)
			}
		default:
			t.Errorf("unknown event type %q", ev.Type)
		}
	}
	if !hasDone {
		t.Errorf("no done event")
	}
	// 门槛：深度 1 全发；深度 2 只发 ≥8MiB。
	if !nodePaths[filepath.Join(root, "big")] {
		t.Errorf("big (depth1) missing from node events: %v", nodePaths)
	}
	if !nodePaths[filepath.Join(root, "big", "deep")] {
		t.Errorf("big/deep (depth2, ≥8MiB) missing from node events: %v", nodePaths)
	}
	if nodePaths[filepath.Join(root, "tiny", "shallow")] {
		t.Errorf("tiny/shallow (depth2, <8MiB) should not be emitted")
	}
	// tiny 是深度 1，必须发射（门槛 a 不看大小）。
	if !nodePaths[filepath.Join(root, "tiny")] {
		t.Errorf("tiny (depth1) missing from node events")
	}
	if s.Root() != root {
		t.Errorf("session root = %s", s.Root())
	}
	if len(s.RecipeHits()) != 0 {
		t.Errorf("unexpected recipe hits: %v", s.RecipeHits())
	}
}

func TestSessionRejectsConcurrentAndCancels(t *testing.T) {
	root := t.TempDir()
	s := New(root)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := s.Start(ctx, StartOptions{Root: root, Emit: func(Event) error { return nil }})
	if err != ErrCancelled {
		t.Fatalf("cancelled start err = %v, want ErrCancelled", err)
	}

	// 取消后再跑一次应成功。
	result, err := s.Start(context.Background(), StartOptions{Root: root, Emit: func(Event) error { return nil }})
	if err != nil || !result.Completed {
		t.Fatalf("restart after cancel: err=%v result=%+v", err, result)
	}
}

func TestSessionRecipeHitsAndRootSwitch(t *testing.T) {
	root := t.TempDir()
	nm := filepath.Join(root, "proj", "node_modules")
	os.MkdirAll(filepath.Join(nm, "x"), 0o755)
	os.WriteFile(filepath.Join(nm, "x", "i.js"), []byte("i"), 0o644)

	s := New(root)
	if _, err := s.Start(context.Background(), StartOptions{Root: root, Emit: func(Event) error { return nil }}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	hits := s.RecipeHits()
	if len(hits) != 1 || hits[0] != filepath.Join(root, "proj", "node_modules") {
		t.Fatalf("hits = %v", hits)
	}
	// 换根清树。
	other := t.TempDir()
	s.SetRoot(other)
	if s.Tree() != nil {
		t.Errorf("SetRoot should clear the tree")
	}
}

func TestSessionExtStats(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "a.MP4"), make([]byte, 100), 0o644)
	os.WriteFile(filepath.Join(root, "b.mp4"), make([]byte, 50), 0o644)
	os.WriteFile(filepath.Join(root, "c.txt"), make([]byte, 10), 0o644)
	os.WriteFile(filepath.Join(root, "noext"), make([]byte, 5), 0o644)

	s := New(root)
	if _, err := s.Start(context.Background(), StartOptions{Root: root, Emit: func(Event) error { return nil }}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	items := s.ExtSnapshot(10)
	if len(items) == 0 {
		t.Fatal("no ext stats")
	}
	byExt := map[string]model.ExtStat{}
	for _, it := range items {
		byExt[it.Ext] = it
	}
	// 大小写归一；allocated ≥ logical，因此断言下限。
	if got := byExt[".mp4"]; got.Ext != ".mp4" || got.Files != 2 || got.Bytes < 150 {
		t.Errorf("mp4 agg = %+v", got)
	}
	if got := byExt[".txt"]; got.Files != 1 || got.Bytes < 10 {
		t.Errorf("txt agg = %+v", got)
	}
	if got := byExt["(无后缀)"]; got.Files != 1 {
		t.Errorf("noext agg = %+v", got)
	}
	if _, ok := byExt[".MP4"]; ok {
		t.Errorf("extension should be lowercased")
	}
}

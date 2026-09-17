// 冒烟测试：不依赖 Host，直接驱动 cgo 引擎层。
// 覆盖：临时目录全量扫描 → status 就绪 → 普通子串搜索 → path: 高级语法 → recent。
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type smokeItem struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type int    `json:"type"`
	Size int64  `json:"size"`
}

func mustJSON(t *testing.T, raw string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("bad json: %v\nraw: %s", err, raw)
	}
	if msg, ok := m["error"].(string); ok {
		t.Fatalf("engine error: %s", msg)
	}
	return m
}

func itemsOf(t *testing.T, m map[string]any) []smokeItem {
	t.Helper()
	raw, _ := json.Marshal(m["items"])
	var items []smokeItem
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("bad items: %v", err)
	}
	return items
}

func TestEngineSmoke(t *testing.T) {
	root := t.TempDir()
	cache := t.TempDir()
	logs := t.TempDir()

	// 夹具：普通文件 + 子目录 + .app bundle 语义旁路用的普通目录
	if err := os.WriteFile(filepath.Join(root, "hello world.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(root, "reports 2026")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "nested_report.docx"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}

	eng, err := NewEngine(root, cache, logs)
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	if err := eng.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	call := func(s string, err error) string {
		t.Helper()
		if err != nil {
			t.Fatalf("engine call: %v", err)
		}
		return s
	}

	// 等索引就绪（记录数 >= 3）
	deadline := time.Now().Add(60 * time.Second)
	for {
		st := mustJSON(t, call(eng.Status()))
		if n, _ := st["records"].(float64); n >= 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("index not ready in time: %s", call(eng.Status()))
		}
		time.Sleep(100 * time.Millisecond)
	}

	// 普通子串搜索
	res := mustJSON(t, call(eng.Search("hello", 100)))
	if items := itemsOf(t, res); len(items) != 1 || items[0].Name != "hello world.txt" {
		t.Fatalf("search 'hello' unexpected: %+v", items)
	}

	// 高级语法：path: 过滤 + 关键词
	res = mustJSON(t, call(eng.Search(`path:"reports 2026" nested`, 100)))
	items := itemsOf(t, res)
	if len(items) != 1 || items[0].Name != "nested_report.docx" {
		t.Fatalf("advanced path query unexpected: %+v", items)
	}

	// 目录类型标记
	res = mustJSON(t, call(eng.Search("reports 2026", 100)))
	found := false
	for _, it := range itemsOf(t, res) {
		if it.Name == "reports 2026" && it.Type == 2 {
			found = true
		}
	}
	if !found {
		t.Fatalf("dir type not reported: %s", call(eng.Search("reports 2026", 100)))
	}

	// recent 非空
	rec := mustJSON(t, call(eng.Recent(10)))
	if items := itemsOf(t, rec); len(items) == 0 {
		t.Fatalf("recent returned nothing")
	}

	// 回归：全量扫描完成后 base 索引必须落盘（否则下次启动又要全量重扫）
	deadlinePersist := time.Now().Add(15 * time.Second)
	baseExists := func() bool {
		for _, name := range []string{"index.v6", "index.bin"} {
			if _, err := os.Stat(filepath.Join(cache, name)); err == nil {
				return true
			}
		}
		return false
	}
	for !baseExists() {
		if time.Now().After(deadlinePersist) {
			t.Fatalf("base index not persisted after scan; cache dir: %s", cache)
		}
		time.Sleep(100 * time.Millisecond)
	}

	// 回归：同缓存目录二次启动必须走缓存（无全量重扫）
	eng2, err := NewEngine(root, cache, logs)
	if err != nil {
		t.Fatalf("NewEngine(2nd): %v", err)
	}
	if err := eng2.Start(); err != nil {
		t.Fatalf("Start(2nd): %v", err)
	}
	deadlineReady2 := time.Now().Add(10 * time.Second)
	for {
		st := mustJSON(t, call(eng2.Status()))
		if n, _ := st["records"].(float64); n >= 3 {
			if scanned, _ := st["scanScanned"].(float64); scanned != 0 {
				t.Fatalf("2nd start did a full rescan (scanScanned=%d)", int64(scanned))
			}
			break
		}
		if time.Now().After(deadlineReady2) {
			t.Fatalf("2nd start did not load cache in time: %s", call(eng2.Status()))
		}
		time.Sleep(50 * time.Millisecond)
	}
}

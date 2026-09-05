package recipe

import (
	"path/filepath"
	"testing"
)

func TestProbe(t *testing.T) {
	home := "/Users/xuan"
	root := home
	existing := map[string]bool{
		filepath.Join(home, "Library/Developer/Xcode/DerivedData"):                        true,
		filepath.Join(home, "Library/Containers/com.docker.docker/Data/vms/0/Docker.raw"): true,
	}
	stat := func(path string) (bool, int64, bool) {
		if !existing[path] {
			return false, 0, false
		}
		if filepath.Base(path) == "Docker.raw" {
			return true, 64 * 1024 * 1024 * 1024, false
		}
		return true, 0, true
	}

	items := Probe(home, root, stat)
	if len(items) != 7 {
		t.Fatalf("items = %d, want 7", len(items))
	}
	byID := map[string]Item{}
	for _, it := range items {
		byID[it.ID] = it
	}
	dd := byID["xcode-derived-data"]
	if !dd.Exists || dd.Kind != "dir" || !dd.InRoot || dd.Bytes != nil {
		t.Errorf("derived data item = %+v", dd)
	}
	docker := byID["docker-raw"]
	if !docker.Exists || docker.Kind != "file" || docker.Bytes == nil || *docker.Bytes != 64<<30 {
		t.Errorf("docker item = %+v", docker)
	}
	if byID["wechat"].Exists {
		t.Errorf("wechat should not exist")
	}
	if !byID["wechat"].InRoot {
		t.Errorf("inRoot is path-based, not existence-based")
	}
}

func TestExtra(t *testing.T) {
	it := Extra("node_modules", "node_modules", "/Users/xuan/proj/node_modules", "/Users/xuan",
		func(string) (bool, int64, bool) { return true, 0, true })
	if it.Kind != "dir" || !it.InRoot || !it.Exists {
		t.Errorf("extra item = %+v", it)
	}
	outside := Extra("node_modules", "node_modules", "/Volumes/other/node_modules", "/Users/xuan",
		func(string) (bool, int64, bool) { return true, 0, true })
	if outside.InRoot {
		t.Errorf("outside node_modules should not be inRoot")
	}
}

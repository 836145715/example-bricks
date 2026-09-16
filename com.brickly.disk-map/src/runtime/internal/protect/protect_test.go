package protect

import (
	"errors"
	"path/filepath"
	"testing"

	"com.brickly.disk-map/internal/model"
)

func TestPolicyUnderRoot(t *testing.T) {
	p := Policy{Root: "/Users/xuan"}
	cases := []struct {
		path    string
		flags   model.NodeFlags
		wantErr error
	}{
		{"/Users/xuan/Downloads/a.zip", model.NodeFlags{Kind: model.KindFile}, nil},
		{"/Users/xuan", model.NodeFlags{}, ErrRootForbidden},
		{"/Users/xuan/../xuan/b", model.NodeFlags{}, nil}, // Clean 后归位
		{"/etc/hosts", model.NodeFlags{}, ErrNotUnderRoot},
		{"relative/path", model.NodeFlags{}, ErrNotUnderRoot},
		{"", model.NodeFlags{}, ErrNotUnderRoot},
	}
	for _, c := range cases {
		err := p.Check(c.path, c.flags)
		if err != c.wantErr {
			t.Errorf("Check(%q) = %v, want %v", c.path, err, c.wantErr)
		}
	}
}

func TestPolicyPrefixLocks(t *testing.T) {
	p := Policy{Root: "/"} // 根扫描时锁前缀更重要
	for _, path := range []string{
		"/System", "/System/Library", "/usr", "/usr/local/bin/x",
		"/bin", "/sbin", "/Library/Apple", "/Library/Apple/usr",
		"/private/var/vm/swapfile0",
	} {
		if err := p.Check(path, model.NodeFlags{}); err != ErrProtectedPre {
			t.Errorf("Check(%q) = %v, want ErrProtectedPre", path, err)
		}
	}
	// /Library 非 Apple 部分不锁。
	if err := p.Check("/Library/Caches", model.NodeFlags{Kind: model.KindDir}); err != nil {
		t.Errorf("Check(/Library/Caches) = %v", err)
	}
	// /private/var/tmp 不在 vm 锁内，但也不在根之下。
	p2 := Policy{Root: "/Users/xuan"}
	if err := p2.Check("/private/var/tmp/x", model.NodeFlags{}); err != ErrNotUnderRoot {
		t.Errorf("Check(/private/var/tmp/x) = %v, want ErrNotUnderRoot", err)
	}
}

func TestPolicyFlags(t *testing.T) {
	p := Policy{Root: "/Users/xuan", RecipePaths: []string{"/Users/xuan/Library/Caches"}}
	cases := []struct {
		name    string
		path    string
		flags   model.NodeFlags
		wantErr error
	}{
		{"protected flags", "/Users/xuan/f", model.NodeFlags{Kind: model.KindFile, Protected: true}, ErrProtectedFlags},
		{"mount", "/Users/xuan/backup", model.NodeFlags{Kind: model.KindDir, Mount: true}, ErrMountPoint},
		{"inaccessible", "/Users/xuan/f", model.NodeFlags{Kind: model.KindDir, Inaccessible: true}, ErrInaccessible},
		{"recipe hit itself", "/Users/xuan/Library/Caches", model.NodeFlags{Kind: model.KindDir}, nil},
		{"recipe hit child", "/Users/xuan/Library/Caches/com.foo/x", model.NodeFlags{Kind: model.KindDir}, nil},
		{"outside recipe + root", "/Users/jane/f", model.NodeFlags{}, ErrNotUnderRoot},
	}
	for _, c := range cases {
		if err := p.Check(c.path, c.flags); err != c.wantErr {
			t.Errorf("%s: Check = %v, want %v", c.name, err, c.wantErr)
		}
	}
}

func TestCheckDockerImage(t *testing.T) {
	if err := CheckDockerImage("/Users/xuan/other.raw", func() (bool, error) { return true, nil }); err != nil {
		t.Errorf("non-docker file should pass, got %v", err)
	}
	if err := CheckDockerImage(filepath.Join("/Users/xuan/Library/Containers/com.docker.docker/Data/vms/0", "Docker.raw"), func() (bool, error) { return false, nil }); err != nil {
		t.Errorf("docker image without docker running should pass, got %v", err)
	}
	if err := CheckDockerImage("/x/Docker.raw", func() (bool, error) { return true, nil }); err != ErrDockerRunning {
		t.Errorf("docker image with docker running = %v, want ErrDockerRunning", err)
	}
	if err := CheckDockerImage("/x/Docker.raw", func() (bool, error) { return false, errors.New("probe failed") }); err != ErrDockerRunning {
		t.Errorf("probe failure should fail closed, got %v", err)
	}
}

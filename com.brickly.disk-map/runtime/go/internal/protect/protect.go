// Package protect 是 trash 前的最后防线：路径归属、锁前缀、危险标志与 Docker 进程检查。
package protect

import (
	"errors"
	"path/filepath"
	"strings"

	"com.brickly.disk-map/internal/model"
)

// PrefixLocks 绝对路径前缀锁：无论扫描根在哪，这些位置都不允许回收。
var PrefixLocks = []string{"/System", "/usr", "/bin", "/sbin", "/Library/Apple", "/private/var/vm"}

// Err 敏感路径拒绝原因（映射到 BppError code）。
var (
	ErrNotUnderRoot   = errors.New("path is not under the scan root or a recipe hit")
	ErrRootForbidden  = errors.New("scan root itself cannot be trashed")
	ErrProtectedPre   = errors.New("path is inside a protected system prefix")
	ErrProtectedFlags = errors.New("path carries immutable/append flags")
	ErrMountPoint     = errors.New("path is a mount point")
	ErrInaccessible   = errors.New("path was not readable during scan")
	ErrDockerRunning  = errors.New("Docker is running; quit Docker before trashing its disk image")
)

// Policy 定义回收白名单边界。
type Policy struct {
	// Root 本次扫描根（含）之上的一切都拒绝。
	Root string
	// RecipePaths recipe 命中路径：其自身与其子路径允许回收。
	RecipePaths []string
}

// Check 校验单个路径。flags 可以为零值（路径不在树里时由调用方 lstat 补齐）。
func (p Policy) Check(path string, flags model.NodeFlags) error {
	if path == "" || !filepath.IsAbs(path) {
		return ErrNotUnderRoot
	}
	path = filepath.Clean(path)

	for _, prefix := range PrefixLocks {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return ErrProtectedPre
		}
	}

	root := filepath.Clean(p.Root)
	if path == root {
		return ErrRootForbidden
	}
	if !under(path, root) {
		covered := false
		for _, rp := range p.RecipePaths {
			rp = filepath.Clean(rp)
			if path == rp || under(path, rp) {
				covered = true
				break
			}
		}
		if !covered {
			return ErrNotUnderRoot
		}
	}

	if flags.Inaccessible {
		return ErrInaccessible
	}
	if flags.Mount {
		return ErrMountPoint
	}
	if flags.Protected {
		return ErrProtectedFlags
	}
	return nil
}

// under 判断 path 是否严格位于 base 之下。
func under(path, base string) bool {
	if base == "/" {
		return path != "/"
	}
	return strings.HasPrefix(path, base+"/")
}

// DockerImageBaseName 会被运行中 Docker 阻止回收的磁盘镜像文件名。
var DockerImageBaseName = "Docker.raw"

// DockerRunning 由调用方注入进程探测（生产用 pgrep -x Docker）。
type DockerRunning func() (bool, error)

// CheckDockerImage 对 Docker.raw 之类的镜像文件做进程检查。
func CheckDockerImage(path string, probe DockerRunning) error {
	if filepath.Base(path) != DockerImageBaseName {
		return nil
	}
	if probe == nil {
		return nil
	}
	running, err := probe()
	if err != nil {
		// 探测失败按「可能在跑」处理，宁可多拦一次。
		return ErrDockerRunning
	}
	if running {
		return ErrDockerRunning
	}
	return nil
}

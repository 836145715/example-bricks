package walker

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"com.brickly.disk-map/internal/model"
)

type modelKind = model.NodeKind

const (
	kindDir   = model.KindDir
	kindFile  = model.KindFile
	kindLink  = model.KindLink
	kindOther = model.KindOther
)

func kindFromObjType(obj uint32) model.NodeKind {
	switch obj {
	case vObjReg:
		return model.KindFile
	case vObjDir:
		return model.KindDir
	case vObjLnk:
		return model.KindLink
	default:
		return model.KindOther
	}
}

// nodeFlagsFromAttr 由裸属性推导 UI 可见的节点标志。
func nodeFlagsFromAttr(kind model.NodeKind, flags uint32, inaccessible, mount bool) model.NodeFlags {
	return model.NodeFlags{
		Kind:         kind,
		Protected:    flags&(flagUFImmutable|flagUFAppend|flagSFImmutable|flagSFAppend) != 0,
		Inaccessible: inaccessible,
		Dataless:     flags&flagSFDataless != 0,
		Mount:        mount,
	}
}

// Entry 是 walker 递给 sink 的一条观察记录。目录聚合（大小/计数）由 tree 负责。
type Entry struct {
	Path       string
	Name       string
	ParentPath string
	Depth      int // 相对扫描根，根的直接孩子为 1
	Flags      model.NodeFlags
	Allocated  int64
	Logical    int64
	FileCount  int64
	DirCount   int64
	// Descend 表示 walker 会继续进入该目录（普通目录才有意义）。
	Descend bool
	// AggregateOnly 为 true 时，tree 不为该目录建独立孩子层（node_modules/.git 等巨叶），
	// 但目录本身仍记录，内部条目并入该目录聚合。
	AggregateOnly bool
}

// Progress 是节流后的扫描进度。
type Progress struct {
	ScannedFiles int64
	ScannedBytes int64
	CurrentPath  string
}

// Sink 接收 walker 产出。
type Sink struct {
	// OnEntry 每发现一个条目调用一次（root 本身不调）。
	OnEntry func(Entry)
	// OnDirDone 在某目录的整棵子树扫完后调用（深度优先完成序）。
	OnDirDone func(path string, depth int)
	// OnProgress 周期回调（walker 内部已节流到 ≥150ms）。
	OnProgress func(Progress)
	// OnRecipeHit 发现 node_modules 等配方巨叶时回调。
	OnRecipeHit func(path string)
	// OnDebug 输出内部诊断（fallback 等），不进 stdout。
	OnDebug func(message string)
}

func (s *Sink) safeOnEntry(e Entry) {
	if s.OnEntry != nil {
		s.OnEntry(e)
	}
}

// ---- os.FileInfo.Sys() 的跨平台取值助手（darwin/linux 的字段类型不同但都可转 uint64）----

func entryStat(fi os.FileInfo) *syscall.Stat_t {
	sys, _ := fi.Sys().(*syscall.Stat_t)
	return sys
}

func stDev(st *syscall.Stat_t) uint64 {
	if st == nil {
		return 0
	}
	return uint64(st.Dev)
}

func stIno(st *syscall.Stat_t) uint64 {
	if st == nil {
		return 0
	}
	return uint64(st.Ino)
}

func stNlink(st *syscall.Stat_t) uint64 {
	if st == nil {
		return 0
	}
	return uint64(st.Nlink)
}

func stBlocks(st *syscall.Stat_t) int64 {
	if st == nil {
		return 0
	}
	return int64(st.Blocks)
}

// SystemPaths 是与扫描无关的锁前缀，扫描时整棵跳过。
var SystemPaths = []string{"/System", "/usr", "/bin", "/sbin", "/private/var/vm", "/dev"}

// GiantLeafNames 计入父目录但不展开孩子的目录名。
var GiantLeafNames = map[string]bool{".git": true, "node_modules": true}

// NodeModulesName 记入 recipe 命中的巨叶名。
const NodeModulesName = "node_modules"

func isSkipped(path string, extraSkip []string) bool {
	if path == "" {
		return false
	}
	for _, prefix := range append(append([]string{}, SystemPaths...), extraSkip...) {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// linkKey 硬链去重键 (fsid, fileid)。
type linkKey struct {
	fsid   uint64
	fileid uint64
}

type linkSet struct {
	mu   sync.Mutex
	seen map[linkKey]struct{}
}

func newLinkSet() *linkSet {
	return &linkSet{seen: make(map[linkKey]struct{})}
}

// claim 返回 true 表示首次出现（应计入占用）；false 表示硬链重复。
// 只跟踪 nlink>1 的文件，绝大多数文件不会进 map。
func (l *linkSet) claim(fsid, fileid uint64, tracked bool) bool {
	if !tracked {
		return true
	}
	key := linkKey{fsid, fileid}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.seen[key]; ok {
		return false
	}
	l.seen[key] = struct{}{}
	return true
}

// CleanRoot 清洗并校验扫描根路径。
func CleanRoot(root string) (string, error) {
	if root == "" {
		return "", errEmptyRoot
	}
	if !filepath.IsAbs(root) {
		return "", errRelativeRoot
	}
	return filepath.Clean(root), nil
}

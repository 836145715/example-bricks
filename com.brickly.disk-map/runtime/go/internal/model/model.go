// Package model 定义磁盘地图对 UI 的 JSON 契约：TreeNode、NodeFlags、ScanEvent 与错误码。
// UI（TypeScript）与 Go 共用同一套字段名。
package model

// NodeKind 节点种类。
type NodeKind string

const (
	KindDir   NodeKind = "dir"
	KindFile  NodeKind = "file"
	KindLink  NodeKind = "link"
	KindOther NodeKind = "other" // 设备、socket、fifo、Other 合并桶
)

// NodeFlags 描述节点的特殊状态，直接来自 walker 的观察。
type NodeFlags struct {
	Kind         NodeKind `json:"kind"`
	Protected    bool     `json:"protected"`    // st_flags 带 immutable/append 位
	Inaccessible bool     `json:"inaccessible"` // EACCES/EPERM，打不开
	Dataless     bool     `json:"dataless"`     // SF_DATALESS
	Mount        bool     `json:"mount"`        // 跨卷挂载点，不深入
}

// NodeSummary 树节点的摘要（不含孩子）。children 数组元素与 scan 的 node 事件都用它。
type NodeSummary struct {
	Path           string    `json:"path"`
	Name           string    `json:"name"`
	AllocatedBytes int64     `json:"allocatedBytes"` // st_blocks*512 口径；硬链按 (fsid,fileid) 只计一次
	LogicalBytes   int64     `json:"logicalBytes"`
	FileCount      int64     `json:"fileCount"`
	DirCount       int64     `json:"dirCount"`
	ChildCount     int64     `json:"childCount,omitempty"` // 直接孩子数量（目录才有）
	Complete       bool      `json:"complete"`
	Flags          NodeFlags `json:"flags"`
}

// TreeNode 是 peek 返回的节点：摘要 + 直接孩子。
type TreeNode struct {
	NodeSummary
	Children []NodeSummary `json:"children"`
}

// OtherName 是合并小头的占位节点名；path 为空。
const OtherName = "其他"

// ProgressEvent 表示扫描进度。go:build 层面无约束，仅文档化字段。
type ProgressEvent struct {
	Root         string `json:"root"`
	ScannedFiles int64  `json:"scannedFiles"`
	ScannedBytes int64  `json:"scannedBytes"`
	CurrentPath  string `json:"currentPath"`
}

// DoneEvent 表示一次扫描结束。
type DoneEvent struct {
	Root         string `json:"root"`
	ScannedFiles int64  `json:"scannedFiles"`
	ScannedBytes int64  `json:"scannedBytes"`
}

// ScanResult 是 scan 命令的返回值。
type ScanResult struct {
	Completed    bool   `json:"completed"`
	Root         string `json:"root"`
	ScannedFiles int64  `json:"scannedFiles"`
	ScannedBytes int64  `json:"scannedBytes"`
}

// ExtStat 是扫描过程中的按扩展名聚合（allocated 口径，含硬链去重）。
type ExtStat struct {
	Ext   string `json:"ext"`
	Bytes int64  `json:"bytes"`
	Files int64  `json:"files"`
}

// PeekResult 是 peek 命令的返回值。
type PeekResult struct {
	Root string   `json:"root"`
	Node TreeNode `json:"node"`
}

// 命令错误码（brickly.NewBppError 的 code）。
const (
	CodeInvalidInput    = "INVALID_INPUT"
	CodeScanInProgress  = "SCAN_IN_PROGRESS"
	CodeNotScanned      = "NOT_SCANNED"
	CodePathNotInTree   = "PATH_NOT_IN_TREE"
	CodeVolumeFailed    = "VOLUME_FAILED"
	CodeRecipeFailed    = "RECIPE_FAILED"
	CodeTrashFailed     = "TRASH_FAILED"
	CodeProtectedPrefix = "PROTECTED_PREFIX"
	CodeNotUnderRoot    = "NOT_UNDER_ROOT"
	CodeProtectedFlags  = "PROTECTED_FLAGS"
	CodeMountPoint      = "MOUNT_POINT"
	CodeInaccessible    = "INACCESSIBLE"
	CodeDockerRunning   = "DOCKER_RUNNING"
	CodeRootForbidden   = "ROOT_FORBIDDEN"
	CodeCancelled       = "CANCELLED"
)

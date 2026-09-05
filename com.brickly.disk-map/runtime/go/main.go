// 磁盘地图 runtime：owned Go 进程做卷快照、流式扫盘、白名单大户和安全回收。
//
// 命令契约（对齐 manifest.json）：
//
//	volume  invoke  卷用量 + 只读本地快照列表
//	scan    call    流式扫描，事件只推进度与浅层节点，明细走 peek
//	peek    invoke  下钻：取某路径节点与直接孩子
//	recipes invoke  固定路径大户（白名单探测，不删除）
//	trash   invoke  protect 校验通过后逐项 ShellTrashItem
//
// 树只存在本进程内存里，不做持久缓存：每次开窗直接流式扫描。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	brickly "github.com/836145715/brickly-sdk-go"

	"com.brickly.disk-map/internal/model"
	"com.brickly.disk-map/internal/protect"
	"com.brickly.disk-map/internal/recipe"
	"com.brickly.disk-map/internal/scan"
	_ "com.brickly.disk-map/internal/stdoutguard"
	"com.brickly.disk-map/internal/volume"
)

var brickRuntime *brickly.Runtime

// TrashSystem 抽出 ShellTrashItem 以便单测。
type TrashSystem interface {
	TrashItem(path string) error
}

type sdkTrash struct{ ctx *brickly.CommandContext }

func (s sdkTrash) TrashItem(path string) error {
	return s.ctx.System().ShellTrashItem(path)
}

var buildStamp = "dev"

func asJSONValue(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

func decodeCommandInput(input json.RawMessage) map[string]any {
	payload := map[string]any{}
	if len(input) > 0 {
		_ = json.Unmarshal(input, &payload)
	}
	return payload
}

func stringFromInput(value any) string {
	typed, _ := value.(string)
	return strings.TrimSpace(typed)
}

func commandError(code, message string) error {
	return brickly.NewBppError(code, message)
}

func logDebug(message string) {
	if brickRuntime != nil {
		brickRuntime.Debug(message, nil)
	}
}

// ---- 会话状态（owned 进程级） ----

var (
	stateMu     sync.Mutex
	session     *scan.Session
	sessionHome string
)

func homeDir(ctx *brickly.CommandContext) string {
	stateMu.Lock()
	if sessionHome != "" {
		home := sessionHome
		stateMu.Unlock()
		return home
	}
	stateMu.Unlock()

	home := ""
	if ctx != nil {
		if p, err := ctx.System().GetPath(brickly.SystemPathHome); err == nil && p != "" {
			home = p
		}
	}
	if home == "" {
		if p, err := os.UserHomeDir(); err == nil {
			home = p
		}
	}
	stateMu.Lock()
	sessionHome = home
	stateMu.Unlock()
	return home
}

func ensureSession(ctx *brickly.CommandContext, root string) *scan.Session {
	stateMu.Lock()
	defer stateMu.Unlock()
	if session == nil {
		session = scan.New(root)
	}
	return session
}

// ---- volume ----

func handleVolume(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	root := stringFromInput(input["root"])
	if root == "" {
		root = homeDir(ctx)
	}
	info, err := volume.Query(root, volume.RealRunner{})
	if err != nil {
		return nil, commandError(model.CodeVolumeFailed, fmt.Sprintf("读取卷用量失败: %v", err))
	}
	return asJSONValue(info)
}

// ---- scan ----

func handleScan(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	root := stringFromInput(input["root"])
	if root == "" {
		root = homeDir(ctx)
	}
	s := ensureSession(ctx, root)

	emit := func(ev scan.Event) error {
		payload, err := asJSONValue(ev)
		if err != nil {
			return err
		}
		return ctx.Send(payload)
	}

	result, err := s.Start(ctx.Context(), scan.StartOptions{
		Root:  root,
		Emit:  emit,
		Debug: logDebug,
	})
	if err != nil {
		switch {
		case err == scan.ErrScanInProgress:
			return nil, commandError(model.CodeScanInProgress, "已有扫描在进行中")
		case err == scan.ErrCancelled:
			return nil, commandError(model.CodeCancelled, "扫描已取消")
		}
		return nil, commandError("SCAN_FAILED", err.Error())
	}

	return asJSONValue(result)
}

// ---- extstats ----

func handleExtStats(ctx *brickly.CommandContext, _ map[string]any) (any, error) {
	s := ensureSession(ctx, homeDir(ctx))
	return asJSONValue(map[string]any{
		"root":  s.Root(),
		"items": s.ExtSnapshot(48),
	})
}

// ---- peek ----

func handlePeek(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	s := ensureSession(ctx, homeDir(ctx))
	path := stringFromInput(input["path"])
	if path == "" {
		path = s.Root()
	}

	// 树未建（本进程未扫描）：返回 PATH_NOT_IN_TREE，UI 显示扫描未到。
	tr := s.Tree()
	if tr == nil {
		return nil, commandError(model.CodePathNotInTree,
			fmt.Sprintf("尚未扫描，无法读取: %s", path))
	}

	node, ok := tr.Node(path)
	if !ok {
		return nil, commandError(model.CodePathNotInTree,
			fmt.Sprintf("路径不在扫描树里（可能还未扫描到或路径无效）: %s", path))
	}
	return asJSONValue(model.PeekResult{Root: s.Root(), Node: node})
}

// ---- recipes ----

func handleRecipes(ctx *brickly.CommandContext, _ map[string]any) (any, error) {
	home := homeDir(ctx)
	s := ensureSession(ctx, home)
	root := s.Root()
	if root == "" {
		root = home
	}
	items := recipe.Probe(home, root, recipe.LstatStat)
	// 扫盘发现的 node_modules 并进来。
	seen := map[string]bool{}
	for _, it := range items {
		seen[it.Path] = true
	}
	for i, hit := range s.RecipeHits() {
		if seen[hit] {
			continue
		}
		items = append(items, recipe.Extra(
			fmt.Sprintf("node_modules-%d", i+1), "node_modules", hit, root, recipe.LstatStat))
	}
	return asJSONValue(map[string]any{"items": items, "root": root})
}

// ---- trash ----

func handleTrash(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	raw, ok := input["paths"].([]any)
	if !ok || len(raw) == 0 {
		return nil, commandError(model.CodeInvalidInput, "paths 必须是非空字符串数组")
	}
	s := ensureSession(ctx, homeDir(ctx))
	tr := s.Tree()

	// 白名单边界 = recipe 固定候选路径 + 扫描发现的 node_modules。
	recipePaths := []string{}
	for _, it := range recipe.Probe(homeDir(ctx), s.Root(), recipe.LstatStat) {
		recipePaths = append(recipePaths, it.Path)
	}
	recipePaths = append(recipePaths, s.RecipeHits()...)

	policy := protect.Policy{Root: s.Root(), RecipePaths: recipePaths}
	var system TrashSystem = sdkTrash{ctx}

	type trashResult struct {
		Path  string `json:"path"`
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}
	results := make([]trashResult, 0, len(raw))
	trashed, failed := 0, 0
	for _, item := range raw {
		path, _ := item.(string)
		path = strings.TrimSpace(path)
		if path == "" {
			results = append(results, trashResult{Path: path, Error: "路径为空"})
			failed++
			continue
		}
		path = filepath.Clean(path)
		res := trashResult{Path: path}

		var flags model.NodeFlags
		if tr != nil {
			if observed, ok := tr.FlagsFor(path); ok {
				flags = observed
			}
		}
		if err := policy.Check(path, flags); err != nil {
			res.Error = protectCode(err) + ": " + err.Error()
			failed++
			results = append(results, res)
			continue
		}
		if err := protect.CheckDockerImage(path, dockerRunning); err != nil {
			res.Error = model.CodeDockerRunning + ": " + err.Error()
			failed++
			results = append(results, res)
			continue
		}
		if err := system.TrashItem(path); err != nil {
			res.Error = model.CodeTrashFailed + ": " + err.Error()
			failed++
			results = append(results, res)
			continue
		}
		if tr != nil {
			tr.Remove(path)
		}
		res.OK = true
		trashed++
		results = append(results, res)
	}
	return asJSONValue(map[string]any{
		"results":      results,
		"trashedCount": trashed,
		"failedCount":  failed,
	})
}

// protectCode 把保护错误映射成错误码。
func protectCode(err error) string {
	switch err {
	case protect.ErrNotUnderRoot:
		return model.CodeNotUnderRoot
	case protect.ErrRootForbidden:
		return model.CodeRootForbidden
	case protect.ErrProtectedPre:
		return model.CodeProtectedPrefix
	case protect.ErrProtectedFlags:
		return model.CodeProtectedFlags
	case protect.ErrMountPoint:
		return model.CodeMountPoint
	case protect.ErrInaccessible:
		return model.CodeInaccessible
	}
	return "PROTECT_FAILED"
}

// dockerRunning 探测名为 Docker 的进程是否在跑。
func dockerRunning() (bool, error) {
	out, err := exec.Command("pgrep", "-x", "Docker").Output()
	if err == nil {
		return len(strings.TrimSpace(string(out))) > 0, nil
	}
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
		return false, nil // pgrep 无命中
	}
	return false, err
}

func main() {
	runtime := brickly.New()
	brickRuntime = runtime

	runtime.OnCommand("volume", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleVolume(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("scan", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleScan(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("peek", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handlePeek(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("extstats", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleExtStats(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("recipes", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleRecipes(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("trash", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleTrash(ctx, decodeCommandInput(input))
	})

	runtime.Start()
}

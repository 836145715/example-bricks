// Package scan 把 walker 与 tree 组装成一次可取消的扫描会话：
// 负责发射门槛（progress 节流、node 只发浅层大户）与 done 收尾。
package scan

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"com.brickly.disk-map/internal/model"
	"com.brickly.disk-map/internal/tree"
	"com.brickly.disk-map/internal/walker"
)

// nodeEmitMinBytes 深度 2 目录进入 node 事件的占用门槛：8MiB。
const nodeEmitMinBytes = 8 << 20

var (
	// ErrScanInProgress 已有扫描在跑。
	ErrScanInProgress = errors.New("a scan is already running")
	// ErrCancelled 被页面 AbortController 取消。
	ErrCancelled = errors.New("scan cancelled")
)

// Event 是发给 UI 的一条事件（对齐 manifest 的 outputEvents）。
type Event struct {
	Type     string               `json:"type"` // progress | node | done
	Progress *model.ProgressEvent `json:"progress,omitempty"`
	Node     *model.NodeSummary   `json:"node,omitempty"`
	Done     *model.DoneEvent     `json:"done,omitempty"`
}

// Session 是 owned 进程里的唯一扫描会话。
type Session struct {
	mu      sync.Mutex
	root    string
	tr      *tree.Tree
	running bool
	cancel  context.CancelFunc
	hits    []string // 扫描发现的 node_modules 等路径
	stats   walker.Stats

	extMu sync.Mutex
	ext   map[string]*model.ExtStat
}

// New 创建空会话（root 为默认根，树未扫描）。
func New(root string) *Session {
	return &Session{root: root, ext: map[string]*model.ExtStat{}}
}

// Root 返回当前扫描根。
func (s *Session) Root() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.root
}

// SetRoot 更新默认根（用户 pickDirectory 后）。清掉旧树。
func (s *Session) SetRoot(root string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.root = filepath.Clean(root)
	s.tr = nil
}

// Tree 返回内存树（未扫描时为 nil）。
func (s *Session) Tree() *tree.Tree {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.tr
}

// Running 报告是否扫描中。
func (s *Session) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// RecipeHits 返回扫描中发现的 node_modules 路径。
func (s *Session) RecipeHits() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.hits))
	copy(out, s.hits)
	return out
}

// Stats 返回最近一次扫描的统计。
func (s *Session) Stats() walker.Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stats
}

// recordExt 聚合一个文件的扩展名占用（walker 每 file 条目回调一次）。
func (s *Session) recordExt(name string, alloc int64) {
	ext := strings.ToLower(filepath.Ext(name))
	if ext == "" || ext == "." {
		ext = "(无后缀)"
	}
	s.extMu.Lock()
	defer s.extMu.Unlock()
	agg, ok := s.ext[ext]
	if !ok {
		agg = &model.ExtStat{Ext: ext}
		s.ext[ext] = agg
	}
	agg.Bytes += alloc
	agg.Files++
}

// ExtSnapshot 返回按占用降序的前 topN 个扩展名。
func (s *Session) ExtSnapshot(topN int) []model.ExtStat {
	s.extMu.Lock()
	list := make([]model.ExtStat, 0, len(s.ext))
	for _, agg := range s.ext {
		list = append(list, *agg)
	}
	s.extMu.Unlock()
	sort.Slice(list, func(i, j int) bool { return list[i].Bytes > list[j].Bytes })
	if len(list) > topN {
		list = list[:topN]
	}
	return list
}

// StartOptions 控制一次扫描。
type StartOptions struct {
	Root string
	// Emit 把事件推给 UI（CommandContext.Send 的包装）。
	Emit func(Event) error
	// Debug 诊断日志。
	Debug func(message string)
}

// Start 运行一次扫描。并发调用返回 ErrScanInProgress。
// 树在换根或首扫时重建；同一根重复扫描清空旧树。
func (s *Session) Start(parent context.Context, opts StartOptions) (model.ScanResult, error) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return model.ScanResult{}, ErrScanInProgress
	}
	ctx, cancel := context.WithCancel(parent)
	s.running = true
	s.cancel = cancel
	s.hits = nil
	root := filepath.Clean(opts.Root)
	s.root = root
	s.tr = tree.New(root)
	tr := s.tr
	s.mu.Unlock()

	s.extMu.Lock()
	s.ext = map[string]*model.ExtStat{}
	s.extMu.Unlock()

	defer func() {
		s.mu.Lock()
		s.running = false
		s.cancel = nil
		s.mu.Unlock()
		cancel()
	}()

	emit := func(ev Event) error {
		if opts.Emit == nil {
			return nil
		}
		return opts.Emit(ev)
	}

	var emitMu sync.Mutex
	var emitErr error
	fail := func(err error) {
		emitMu.Lock()
		if emitErr == nil {
			emitErr = err
		}
		emitMu.Unlock()
		// 事件流已断（页面上报失败），继续扫没有意义。
		cancel()
	}

	sink := walker.Sink{
		OnEntry: func(e walker.Entry) {
			tr.Apply(e)
			if e.FileCount > 0 {
				s.recordExt(e.Name, e.Allocated)
			}
		},
		OnDirDone: func(path string, depth int) {
			// 先把完成状态落进树，再按门槛决定是否发 node 事件。
			tr.CompleteDir(path)
			summary, ok := tr.Summary(path)
			if !ok {
				return
			}
			if depth == 2 && summary.AllocatedBytes < nodeEmitMinBytes {
				return
			}
			if depth == 0 || depth > 2 {
				return
			}
			if err := emit(Event{Type: "node", Node: &summary}); err != nil {
				fail(err)
			}
		},
		OnProgress: func(p walker.Progress) {
			err := emit(Event{Type: "progress", Progress: &model.ProgressEvent{
				ScannedFiles: p.ScannedFiles,
				ScannedBytes: p.ScannedBytes,
				CurrentPath:  p.CurrentPath,
			}})
			if err != nil {
				fail(err)
			}
		},
		OnRecipeHit: func(path string) {
			s.mu.Lock()
			s.hits = append(s.hits, path)
			s.mu.Unlock()
		},
		OnDebug: opts.Debug,
	}

	stats, walkErr := walker.Walk(ctx, walker.Options{
		Root: root,
		Skip: []string{filepath.Join(root, ".Trash")},
		Sink: sink,
	})

	s.mu.Lock()
	s.stats = stats
	s.mu.Unlock()

	result := model.ScanResult{
		Root:         root,
		ScannedFiles: stats.ScannedFiles,
		ScannedBytes: stats.ScannedBytes,
	}
	if walkErr != nil {
		if ctx.Err() != nil {
			return result, ErrCancelled
		}
		return result, walkErr
	}
	emitMu.Lock()
	err := emitErr
	emitMu.Unlock()
	if err != nil {
		return result, err
	}

	doneEv := &model.DoneEvent{
		Root:         root,
		ScannedFiles: stats.ScannedFiles,
		ScannedBytes: stats.ScannedBytes,
	}
	if err := emit(Event{Type: "done", Done: doneEv}); err != nil {
		return result, err
	}
	result.Completed = true
	return result, nil
}

// Cancel 请求取消进行中的扫描。
func (s *Session) Cancel() {
	s.mu.Lock()
	cancel := s.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

package walker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"com.brickly.disk-map/internal/model"
)

var (
	errEmptyRoot    = errors.New("scan root is empty")
	errRelativeRoot = errors.New("scan root must be an absolute path")
)

// Options 控制一次扫描。
type Options struct {
	Root string
	// Skip 是额外整棵跳过的绝对路径前缀（如 root/.Trash）。
	Skip []string
	// Workers 同层并发目录数，默认 4。
	Workers int
	// BufferSize getattrlistbulk 缓冲字节数，默认 256KB。
	BufferSize int
	// ProgressEvery 进度节流间隔，默认 150ms。
	ProgressEvery time.Duration
	Sink          Sink
}

// Stats 是一次扫描结束后的总量。
type Stats struct {
	ScannedFiles int64
	ScannedBytes int64
}

const (
	defaultWorkers  = 4
	defaultBufferKB = 256
)

type dirJob struct {
	path          string
	parent        string
	depth         int
	aggregateOnly bool
}

// jobQueue 是无界作业队列：worker 既是生产者又是消费者，
// 有界 channel 会在全部 worker 同时阻塞在发送上时死锁。
// 用 Cond 是因为 close/cancel 需要广播唤醒所有等待的 worker。
type jobQueue struct {
	mu     sync.Mutex
	cond   *sync.Cond
	jobs   []dirJob
	closed bool
}

func newJobQueue() *jobQueue {
	q := &jobQueue{}
	q.cond = sync.NewCond(&q.mu)
	return q
}

func (q *jobQueue) push(j dirJob) {
	q.mu.Lock()
	q.jobs = append(q.jobs, j)
	q.mu.Unlock()
	q.cond.Signal()
}

func (q *jobQueue) close() {
	q.mu.Lock()
	q.closed = true
	q.mu.Unlock()
	q.cond.Broadcast()
}

type walker struct {
	opts Options
	sink Sink
	ctx  context.Context

	q       *jobQueue
	quit    chan struct{}
	closeQ  sync.Once
	workers sync.WaitGroup

	mu       sync.Mutex        // 保护下面三个 map 与 finished
	pending  map[string]int    // 目录 -> 未完成的已推送孩子数
	readDone map[string]bool   // 目录读循环已结束
	jobsByID map[string]dirJob // 在途作业，级联时取回 depth
	finished bool

	rootFSID uint64
	rootDev  uint64

	files   atomic.Int64
	bytes   atomic.Int64
	current atomic.Value // string
	links   *linkSet
}

// Walk 扫描 opts.Root 下整棵目录树，把条目推给 Sink.OnEntry，
// 子树完成时调用 OnDirDone，期间周期回调 OnProgress（已节流）。
// 返回时所有 worker 已退出；ctx 取消时提前返回 ctx.Err()。
func Walk(ctx context.Context, opts Options) (Stats, error) {
	root, err := CleanRoot(opts.Root)
	if err != nil {
		return Stats{}, err
	}
	if !isDir(root) {
		return Stats{}, fmt.Errorf("scan root is not a directory: %s", root)
	}
	fsid, dev, err := rootVolumeIDs(root)
	if err != nil {
		return Stats{}, fmt.Errorf("cannot read root volume: %w", err)
	}

	if opts.Workers <= 0 {
		opts.Workers = defaultWorkers
	}
	if opts.BufferSize <= 0 {
		opts.BufferSize = defaultBufferKB * 1024
	}
	if opts.ProgressEvery <= 0 {
		opts.ProgressEvery = 150 * time.Millisecond
	}

	w := &walker{
		opts:     opts,
		sink:     opts.Sink,
		ctx:      ctx,
		q:        newJobQueue(),
		quit:     make(chan struct{}),
		pending:  map[string]int{},
		readDone: map[string]bool{},
		jobsByID: map[string]dirJob{},
		rootFSID: fsid,
		rootDev:  dev,
		links:    newLinkSet(),
	}
	w.current.Store(root)

	// 取消广播：ctx 一旦结束就关 quit。
	watchDone := make(chan struct{})
	defer close(watchDone)
	go func() {
		select {
		case <-ctx.Done():
			w.closeQuit()
		case <-watchDone:
		}
	}()

	// 进度节流循环。
	var progressWG sync.WaitGroup
	progressWG.Add(1)
	go func() {
		defer progressWG.Done()
		w.progressLoop()
	}()

	w.workers.Add(opts.Workers)
	for i := 0; i < opts.Workers; i++ {
		go w.worker()
	}

	// 根目录打不开直接报错，不给 UI 一个空图。
	if err := precheckRoot(root); err != nil {
		w.closeQuit()
		w.workers.Wait()
		return Stats{}, err
	}

	w.push(dirJob{path: root, depth: 0})
	w.workers.Wait()

	stats := Stats{ScannedFiles: w.files.Load(), ScannedBytes: w.bytes.Load()}
	if err := ctx.Err(); err != nil {
		return stats, err
	}
	return stats, nil
}

func (w *walker) closeQuit() {
	w.closeQ.Do(func() {
		close(w.quit)
		w.q.cond.Broadcast() // 唤醒所有在取作业的 worker
	})
}

func isDir(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}

func precheckRoot(root string) error {
	f, err := os.Open(root)
	if err != nil {
		return fmt.Errorf("cannot open scan root: %w", err)
	}
	return f.Close()
}

// rootVolumeIDs 返回 (fsid, dev)。bulk 条目的 fsid 按 val[0]（u32）解析，这里保持同口径。
func rootVolumeIDs(root string) (uint64, uint64, error) {
	fsid, err := rootFSID(root)
	if err != nil {
		return 0, 0, err
	}
	st, err := os.Lstat(root)
	if err != nil {
		return 0, 0, err
	}
	return fsid, stDev(entryStat(st)), nil
}

func (w *walker) worker() {
	defer w.workers.Done()
	for {
		// 取作业：队列空则等待（close/cancel 广播唤醒）。
		w.q.mu.Lock()
		for len(w.q.jobs) == 0 && !w.q.closed {
			select {
			case <-w.quit:
				w.q.mu.Unlock()
				return
			default:
			}
			w.q.cond.Wait()
		}
		if len(w.q.jobs) == 0 { // 队列已关闭且取空
			w.q.mu.Unlock()
			return
		}
		job := w.q.jobs[0]
		w.q.jobs = w.q.jobs[1:]
		w.q.mu.Unlock()

		if w.ctx.Err() != nil {
			w.finish(job)
			continue
		}
		w.readDir(job)
	}
}

func (w *walker) push(job dirJob) {
	w.mu.Lock()
	w.jobsByID[job.path] = job
	w.pending[job.parent]++
	w.mu.Unlock()
	w.q.push(job)
}

// readDir 读一个目录并把条目推给 sink；无论成败都登记 readDone。
func (w *walker) readDir(job dirJob) {
	defer w.finish(job)

	f, err := os.Open(job.path)
	if err != nil {
		w.handleOpenError(job, err)
		return
	}
	defer f.Close()

	// getattrlistbulk 与 getdirentries 共享 fd 的目录偏移；
	// bulk 中途失败时回退 readdir 只会读到剩余条目，不会整目录重复。
	if err := w.bulkLoop(f, job); err != nil {
		if errors.Is(err, os.ErrPermission) {
			w.markInaccessible(job)
			return
		}
		if errors.Is(err, os.ErrNotExist) {
			return
		}
		w.debug("getattrlistbulk failed on %s (%v), falling back to readdir+lstat", job.path, err)
		w.fallbackDir(f, job)
	}
}

func (w *walker) handleOpenError(job dirJob, err error) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		// 目录被并发删掉，静默跳过
	case errors.Is(err, os.ErrPermission):
		w.markInaccessible(job)
	default:
		w.debug("open %s failed: %v", job.path, err)
	}
}

func (w *walker) markInaccessible(job dirJob) {
	w.sink.safeOnEntry(Entry{
		Path:       job.path,
		Name:       filepath.Base(job.path),
		ParentPath: filepath.Dir(job.path),
		Depth:      job.depth,
		Flags:      model.NodeFlags{Kind: model.KindDir, Inaccessible: true},
	})
}

// bulkLoop 用 getattrlistbulk 消费目录；失败时返回 error 交给上层决定回退。
func (w *walker) bulkLoop(f *os.File, job dirJob) error {
	attrList := bulkAttrList()
	buf := make([]byte, w.opts.BufferSize)
	for {
		if w.ctx.Err() != nil {
			return nil
		}
		n, err := bulkRead(int(f.Fd()), attrList, buf)
		if err != nil {
			if errors.Is(err, os.ErrPermission) || errors.Is(err, os.ErrNotExist) {
				return err
			}
			return err
		}
		if n == 0 {
			return nil
		}
		offset := 0
		for i := 0; i < n; i++ {
			if offset+4 > len(buf) {
				return fmt.Errorf("attr buffer overruns after %d entries in %s", i, job.path)
			}
			entryLen := int(buf[offset]) | int(buf[offset+1])<<8 | int(buf[offset+2])<<16 | int(buf[offset+3])<<24
			if entryLen <= 0 || offset+entryLen > len(buf) {
				return fmt.Errorf("corrupt attr entry at %d in %s", offset, job.path)
			}
			attrs, perr := ParseEntry(buf[offset : offset+entryLen])
			if perr != nil {
				return perr
			}
			offset += entryLen
			if w.emitBulkEntry(job, attrs) {
				return nil
			}
		}
	}
}

// emitBulkEntry 把一条 bulk 记录转成 Entry 发给 sink；返回 true 表示应中止。
func (w *walker) emitBulkEntry(job dirJob, attrs AttrEntry) bool {
	if attrs.Name == "" || attrs.Name == "." || attrs.Name == ".." {
		return false
	}
	path := filepath.Join(job.path, attrs.Name)
	if isSkipped(path, w.opts.Skip) {
		return false
	}
	kind := kindFromObjType(attrs.ObjType)
	entry := Entry{
		Path:       path,
		Name:       attrs.Name,
		ParentPath: job.path,
		Depth:      job.depth + 1,
		Flags:      nodeFlagsFromAttr(kind, attrs.Flags, false, false),
	}

	switch kind {
	case model.KindFile:
		// 硬链按 (fsid,fileid) 只计一次；nlink==1 的文件不会进去重集合。
		if w.links.claim(attrs.FSID, attrs.FileID, attrs.FileLinks > 1) {
			entry.Allocated = attrs.FileAlloc
			entry.Logical = attrs.FileTotal
		}
		entry.FileCount = 1
		w.files.Add(1)
		w.bytes.Add(entry.Allocated)
	case model.KindDir:
		if attrs.FSID != w.rootFSID {
			entry.Flags.Mount = true // 跨卷挂载点：不深入
		}
		entry.DirCount = 1
		entry.AggregateOnly = GiantLeafNames[attrs.Name]
		entry.Descend = !entry.Flags.Mount
		if entry.AggregateOnly && attrs.Name == NodeModulesName {
			w.onRecipeHit(path)
		}
	case model.KindLink:
		// 不跟随符号链接：allocated=0
	default:
		// 设备、socket、fifo：占位展示
	}
	w.current.Store(path)
	w.sink.safeOnEntry(entry)

	if kind == model.KindDir && entry.Descend {
		w.push(dirJob{
			path:          path,
			parent:        job.path,
			depth:         entry.Depth,
			aggregateOnly: job.aggregateOnly || entry.AggregateOnly,
		})
	}
	return w.ctx.Err() != nil
}

func (w *walker) onRecipeHit(path string) {
	if w.sink.OnRecipeHit != nil {
		w.sink.OnRecipeHit(path)
	}
}

// fallbackDir 用 Readdirnames + Lstat 补齐目录剩余条目。
// bulk 与 readdir 共享 fd 偏移，中途失败时这里只发未消费的部分。
func (w *walker) fallbackDir(f *os.File, job dirJob) {
	names, err := f.Readdirnames(-1)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			w.markInaccessible(job)
			return
		}
		if !errors.Is(err, os.ErrNotExist) {
			w.debug("readdir %s failed: %v", job.path, err)
		}
		return
	}
	for _, name := range names {
		if w.ctx.Err() != nil {
			return
		}
		path := filepath.Join(job.path, name)
		if isSkipped(path, w.opts.Skip) {
			continue
		}
		st, err := os.Lstat(path)
		if err != nil {
			continue
		}
		w.emitStatEntry(job, path, name, st)
	}
}

func (w *walker) emitStatEntry(job dirJob, path, name string, st os.FileInfo) {
	entry := Entry{
		Path:       path,
		Name:       name,
		ParentPath: job.path,
		Depth:      job.depth + 1,
	}
	sys := entryStat(st)
	mode := st.Mode()
	switch {
	case mode.IsDir():
		entry.Flags.Kind = model.KindDir
	case mode.IsRegular():
		entry.Flags.Kind = model.KindFile
	case mode&os.ModeSymlink != 0:
		entry.Flags.Kind = model.KindLink
	default:
		entry.Flags.Kind = model.KindOther
	}
	flags := statFlags(sys)
	entry.Flags.Protected = flags&(flagUFImmutable|flagUFAppend|flagSFImmutable|flagSFAppend) != 0
	entry.Flags.Dataless = flags&flagSFDataless != 0
	entry.Flags.Mount = entry.Flags.Kind == model.KindDir && stDev(sys) != w.rootDev

	switch entry.Flags.Kind {
	case model.KindFile:
		if w.links.claim(uint64(stDev(sys)), uint64(stIno(sys)), uint64(stNlink(sys)) > 1) {
			entry.Allocated = stBlocks(sys) * 512
			entry.Logical = st.Size()
		}
		entry.FileCount = 1
		w.files.Add(1)
		w.bytes.Add(entry.Allocated)
	case model.KindDir:
		entry.DirCount = 1
		entry.AggregateOnly = GiantLeafNames[name]
		entry.Descend = !entry.Flags.Mount
		if entry.AggregateOnly && name == NodeModulesName {
			w.onRecipeHit(path)
		}
	}
	w.current.Store(path)
	w.sink.safeOnEntry(entry)

	if entry.Flags.Kind == model.KindDir && entry.Descend {
		w.push(dirJob{
			path:          path,
			parent:        job.path,
			depth:         entry.Depth,
			aggregateOnly: job.aggregateOnly || entry.AggregateOnly,
		})
	}
}

// finish 登记一个目录作业读循环结束，并沿 pending 计数向上级联完成。
func (w *walker) finish(job dirJob) {
	w.mu.Lock()
	w.readDone[job.path] = true
	w.completeLocked(job.path)
	w.mu.Unlock()
}

// completeLocked 完成一个目录：通知 sink、给父目录计数减一，再尝试级联。
// 只在 readDone && pending==0 时触发；取消后不再通知 sink。
func (w *walker) completeLocked(path string) {
	if !w.readDone[path] || w.pending[path] != 0 || w.finished {
		return
	}
	job := w.jobsByID[path]
	delete(w.jobsByID, path)
	delete(w.readDone, path)
	delete(w.pending, path)

	if w.ctx.Err() == nil && w.sink.OnDirDone != nil {
		w.sink.OnDirDone(job.path, job.depth)
	}
	if job.parent == "" {
		w.finished = true
		w.q.close()
		return
	}
	if w.pending[job.parent] > 0 {
		w.pending[job.parent]--
	}
	w.completeLocked(job.parent)
}

// progressLoop 周期推送进度，间隔不小于 150ms；由 Walk 里的 goroutine 驱动。
func (w *walker) progressLoop() {
	ticker := time.NewTicker(w.opts.ProgressEvery)
	defer ticker.Stop()
	for {
		select {
		case <-w.quit:
			return
		case <-ticker.C:
			if w.sink.OnProgress != nil {
				w.sink.OnProgress(Progress{
					ScannedFiles: w.files.Load(),
					ScannedBytes: w.bytes.Load(),
					CurrentPath:  w.current.Load().(string),
				})
			}
		}
	}
}

func (w *walker) debug(format string, args ...any) {
	if w.sink.OnDebug != nil {
		w.sink.OnDebug(fmt.Sprintf(format, args...))
	}
}

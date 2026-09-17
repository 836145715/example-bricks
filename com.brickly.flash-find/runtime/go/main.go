// 闪电搜索 runtime：owned Go 进程做 brickly 协议接线人。
//
// 命令契约（对齐 manifest.json）：
//
//	search  invoke  并行  查询引擎（透传 Everything 风格语法）
//	status  invoke  并行  引擎状态（Go 侧 500ms 节流轮询 C 原子计数）
//	reindex invoke        全量重建索引
//	recent  invoke        最近修改的文件
//
// 引擎（vendored MacEverything Core，进程内）在进程启动时即开始
// 增量加载 / 全盘扫描，用户开窗输入时索引多半已就绪。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	brickly "github.com/836145715/brickly-sdk-go"
)

var buildStamp = "dev"

// ---- 引擎生命周期（owned 进程级单例） ----

var (
	engineMu   sync.Mutex
	engine     *Engine
	engineErr  error
	engineOnce sync.Once
)

func cacheDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "/tmp"
	}
	return filepath.Join(home, "Library", "Caches", "com.brickly.flash-find")
}

func logDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "/tmp"
	}
	return filepath.Join(home, "Library", "Logs", "com.brickly.flash-find")
}

// ensureEngine 进程一启动就被 main 调一次；之后各命令直接取。
func ensureEngine() (*Engine, error) {
	engineOnce.Do(func() {
		dir := cacheDir()
		_ = os.MkdirAll(dir, 0o755)
		_ = os.MkdirAll(logDir(), 0o755)
		eng, err := NewEngine("/", dir, logDir())
		if err != nil {
			engineErr = err
			return
		}
		if err := eng.Start(); err != nil {
			engineErr = fmt.Errorf("engine start: %w", err)
			return
		}
		engine = eng
	})
	return engine, engineErr
}

// ---- 输入解析与通用工具 ----

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

func intFromInput(value any, fallback int) int {
	switch v := value.(type) {
	case float64:
		if v > 0 {
			return int(v)
		}
	case json.Number:
		if n, err := v.Int64(); err == nil && n > 0 {
			return int(n)
		}
	}
	return fallback
}

func commandError(code, message string) error {
	return brickly.NewBppError(code, message)
}

// ---- search ----

func handleSearch(ctx *brickly.CommandContext, input map[string]any) (any, error) {
	eng, err := ensureEngine()
	if err != nil {
		return nil, commandError("FF_ENGINE_FAILED", "索引引擎初始化失败: "+err.Error())
	}

	query := stringFromInput(input["query"])
	if query == "" {
		return nil, commandError("FF_EMPTY_QUERY", "query 不能为空（最近文件请用 recent 命令）")
	}
	limit := intFromInput(input["limit"], 200)
	if limit > 1000 {
		limit = 1000
	}

	// scope 是路径前缀过滤，映射为引擎的 path: 过滤语法。
	if scope := stringFromInput(input["scope"]); scope != "" {
		escaped := strings.ReplaceAll(scope, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)
		query = fmt.Sprintf(`%s path:"%s"`, query, escaped)
	}

	raw, err := eng.Search(query, limit)
	if err != nil {
		return nil, commandError("FF_SEARCH_FAILED", "搜索失败: "+err.Error())
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, commandError("FF_SEARCH_FAILED", "引擎输出解析失败: "+err.Error())
	}
	if msg, ok := decoded["error"].(string); ok {
		return nil, commandError("FF_SEARCH_FAILED", "引擎错误: "+msg)
	}
	return asJSONValue(decoded)
}

// ---- status ----

type statusCache struct {
	mu      sync.Mutex
	raw     string
	at      time.Time
	errText string
}

var stCache statusCache

const statusMinInterval = 500 * time.Millisecond

func handleStatus(_ *brickly.CommandContext, _ map[string]any) (any, error) {
	eng, err := ensureEngine()
	if err != nil {
		return asJSONValue(map[string]any{
			"engineReady": false,
			"error":       err.Error(),
		})
	}

	stCache.mu.Lock()
	defer stCache.mu.Unlock()
	now := time.Now()
	if stCache.raw == "" || now.Sub(stCache.at) >= statusMinInterval {
		raw, err := eng.Status()
		if err != nil {
			stCache.errText = err.Error()
		} else {
			stCache.raw = raw
			stCache.errText = ""
		}
		stCache.at = now
	}
	if stCache.errText != "" {
		return nil, commandError("FF_STATUS_FAILED", "读取引擎状态失败: "+stCache.errText)
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(stCache.raw), &decoded); err != nil {
		return nil, commandError("FF_STATUS_FAILED", "引擎状态解析失败: "+err.Error())
	}
	decoded["engineReady"] = true
	decoded["buildStamp"] = buildStamp
	return asJSONValue(decoded)
}

// ---- reindex ----

func handleReindex(_ *brickly.CommandContext, _ map[string]any) (any, error) {
	eng, err := ensureEngine()
	if err != nil {
		return nil, commandError("FF_ENGINE_FAILED", "索引引擎初始化失败: "+err.Error())
	}
	if err := eng.Rebuild(); err != nil {
		return nil, commandError("FF_REBUILD_FAILED", "重建失败: "+err.Error())
	}
	return asJSONValue(map[string]any{"started": true})
}

// ---- recent ----

func handleRecent(_ *brickly.CommandContext, input map[string]any) (any, error) {
	eng, err := ensureEngine()
	if err != nil {
		return nil, commandError("FF_ENGINE_FAILED", "索引引擎初始化失败: "+err.Error())
	}
	limit := intFromInput(input["limit"], 50)
	if limit > 500 {
		limit = 500
	}
	raw, err := eng.Recent(limit)
	if err != nil {
		return nil, commandError("FF_RECENT_FAILED", "读取最近文件失败: "+err.Error())
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, commandError("FF_RECENT_FAILED", "引擎输出解析失败: "+err.Error())
	}
	if msg, ok := decoded["error"].(string); ok {
		return nil, commandError("FF_RECENT_FAILED", "引擎错误: "+msg)
	}
	return asJSONValue(decoded)
}

func main() {
	runtime := brickly.New()

	// 进程起来就开始建索引/加载缓存，用户开窗即搜。
	_, _ = ensureEngine()

	runtime.OnCommand("search", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleSearch(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("status", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleStatus(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("reindex", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleReindex(ctx, decodeCommandInput(input))
	})
	runtime.OnCommand("recent", func(ctx *brickly.CommandContext, input json.RawMessage) (any, error) {
		return handleRecent(ctx, decodeCommandInput(input))
	})

	runtime.Start()
}

# 日志查询工具

status: active
type: brick
related_code: runtime/main.go, runtime/browse.go, runtime/search_shared.go, runtime/ssh.go, src/App.tsx, src/components/FileSelectDropdown.tsx, src/components/RemotePathBrowser.tsx, src/components/LogVirtualList.tsx
last_verified: 2026-08-24

`com.brickly.log-searcher` 提供 SSH 远程日志的流式检索能力。Host↔Runtime 走现行 gRPC（`invoke` / `interact`），Go 侧用 `brickly.OnCommand` + `ctx.Send`。UI 适合人工排查日志，`search` 声明 `mode: "call"`，调用方用 `call(..., { onEvent })` 收 `logLine` / `searchState`。`runtime.instance` 必须显式为 `owned`：搜索结果存在该 Lifetime 独占的 Go 进程内存里，不能 `per-call`，也不能省略（省略只补 `shared`）。

架构取舍、路径选择交互和后续 SearchJob 收口见 [docs/design.md](docs/design.md)。

配置连接时可以浏览远程目录、点选文件或写入 `*.log` 通配符，不必只靠手填。工具栏按目录分组选择本次检索的具体文件；未选时会使用最近修改的 5 个文件，并在选择器里说明。

体验窗使用 **`titleBar: "custom"`** 自绘标题栏（拖动区 + 最小化 / 最大化 / 关闭），依赖平台 `window.brickly.window`。`owned` 实例开窗不钉进程：页面必须先 `await window.brickly.start()`，再用 Handle 的 `invoke` / `call` / `interact`。直接 `window.brickly.invoke` 会建 Call 级临时 Lifetime，命令结束进程就被 SIGTERM。`search` 是 `mode=call`：用 `runtime.call(..., { onEvent })` 收 `logLine` / `searchState`，取消走 `AbortController`。`window.brickly` 的 TypeScript 类型来自 `@syllm/brickly-ui`；本工具 `types.ts` 只保留检索/配置等业务类型。

## search 能力

输入：

- `serverId`：必填，使用已保存的服务器配置。
- `pattern`：必填，主检索关键词或正则。
- `files`：可选，具体日志文件路径数组；不传时使用服务器配置中已启用的日志路径。
- `filters`：可选，链式过滤条件数组，按顺序继续缩小结果。每项支持 `pattern`、`regexp`、`ignoreCase`、`invert`、`wordRegexp`。
- `args`：可选，grep 行为选项，包括 `ignoreCase`、`invert`、`wordRegexp`、`regexp`、`contextA`、`contextB`、`contextC`、`onlyMatch`、`maxCount`、`showLineNum`、`showFilename`、`fromTail`、`tailLines`。为兼容旧调用，`args.filters` 仍可传链式过滤，但顶层 `filters` 更直观。
- `resultMode`：可选。默认不传时保持兼容流式输出；传 `"store"` 时结果存储在 Go runtime 内存中，前端通过 `peek_search_results` 按窗口读取。

输出（interact 事件，不是旧 BPP chunk）：

- `{ type: "progress", progress, message }`：连接/完成提示。
- `{ type: "logLine", logLine }`：兼容流式行 `{ text, matches, file, isContext, error }`。
- `{ type: "searchState", searchState }`：仅 `resultMode="store"` 时推送，包含 `runId`、`tabs`、各文件 `total/status/message/durationMs/truncated`。
- 终态 `result`：`{ completed: true, runId? }`。
- `text` 是最终展示的日志行。
- `matches` 是主检索词及正向链式过滤词在 `text` 中的高亮区间 `[start, end)`；排除型过滤不会高亮。区间单位固定为 UTF-16 code unit，可直接用于浏览器 `String.prototype.slice`。
- `file` 是命中来源文件路径，用于 UI 多文件 Tab 分组；`isContext` 表示该行是否来自上下文输出；`error` 是可选的文件级错误信息。

### 最新命中限制

`args.maxCount>0` 时，限制语义是“每个文件保留最新 `maxCount` 条命中行”，不是 `grep -m` 的“从文件头返回前 N 条”。运行时会先按文件原始顺序完成过滤，只保留尾部最新命中，最终仍按日志原始顺序从旧到新输出。上下文行不计入 `maxCount`，但会随保留下来的命中一起输出，因此展示行数可能略多于 `maxCount`。

UI 默认每个文件保留最新 500 条命中。

### 尾部搜索

设置 `args.fromTail=true` 且 `args.tailLines>0` 时，只在每个目标文件最后 `tailLines` 行内搜索。UI 默认关闭此模式；开启后默认搜索最后 1000 行，以便快速排查正在增长的大日志。若同时设置 `maxCount`，会先限定尾部扫描窗口，再在窗口内保留最新命中。未开启 `fromTail` 时，远程 `grep` 会扫描完整文件；当 `maxCount>0` 时，为保证最新语义，单个文件会在扫描完成后再输出保留下来的结果。

UI 中选择多个日志文件时，工具会为每个文件创建独立结果 Tab；不再渲染“全部”聚合视图，避免重复上下文。文件列表通过远程 `file --mime-type` 识别文件头，仅保留可直接由 `grep` 检索的文本 MIME 类型，并按最后修改时间倒序排列；JAR、图片和其他二进制文件会被排除。若远程机未安装 `file`，会保留全部路径但仍按修改时间排序。每个文件 Tab 会显示列出时读取的远程文件大小，结果列表、滚动位置、计数和错误状态互相隔离；Tab 圆点提示等待、检索中、完成、出错或取消，出错文件会在对应结果视图中展示具体错误信息。多文件搜索会复用同一个 SSH 连接，并以最多 6 个远程 grep 会话并发查询，避免每个 Tab 反复握手。

### Go 侧存储模式

UI 默认使用 `resultMode="store"`：搜索结果按 `serverId/runId/tabId` 保存在 Go runtime 内存中，renderer 只保存当前虚拟列表窗口。每次同一服务器开始新搜索时，会清理该服务器旧结果并取消旧搜索，避免旧数据泄露到新结果。`maxCount=0` 时 store 模式每个文件最多保留最新 50000 行输出，超过后设置 `truncated=true`。

`peek_search_results` 用于读取窗口数据，输入 `{ serverId, runId, tabId, offset, limit }`，返回 `{ runId, tabId, total, offset, lines, status, message, durationMs, truncated }`。`limit` 最大 1000。`find_search_results` 用于在当前文件 Tab 的 Go 侧已存结果内定位上一个或下一个文本命中，返回 `{ total, ordinal, lineIndex, start, end }` 等字段。`clear_search_results` 用于清理某个服务器的 Go 侧结果，输入 `{ serverId }`。

UI 结果区默认使用自动换行虚拟列表，通过动态行高测量展示长日志；右下角提供“到顶部 / 到底部”快捷按钮，便于在大结果集内显式跳转。需要高密度横向浏览时，可切换为“单行”模式。Ctrl+F 会高亮当前已加载视图窗口，并可通过上一个/下一个在当前 Tab 的 Go 侧已存结果中定位跳转；查找关键词与查找栏开关按「连接服务器」页面独立保存，切换服务器不会串状态。复制按钮只复制当前已加载视图窗口，不会一次性拉取全部结果。

示例：

```json
{
  "serverId": "srv_prod",
  "pattern": "error",
  "files": ["/var/log/app/app.log"],
  "resultMode": "store",
  "filters": [
    { "pattern": "userId=42", "ignoreCase": true },
    { "pattern": "debug|trace", "regexp": true, "invert": true }
  ],
  "args": {
    "ignoreCase": true,
    "maxCount": 500,
    "fromTail": true,
    "tailLines": 2000
  }
}
```

## browse_remote_path 能力

输入：

- `server` 或 `serverId`：二选一。编辑未保存连接时传完整 `server`。
- `path`：可选。远程目录、文件或通配符；空则默认 `/var/log` 或家目录。

行为：

- 目录：列出子目录和文件，目录在前，最多 400 项。
- 通配符：展开匹配文件并回传 `pattern`，便于预览后再写入配置。
- 文件：打开其所在目录。

输出：`path`、`parent`、`pattern?`、`entries`、`truncated`。

修改 Go runtime 后需要重新编译 `runtime/win-x64/brick.exe`，否则体验窗仍是旧二进制，浏览命令会找不到。

## test_connection 能力

输入：

- `server`：必填，完整 `ServerConfig` 对象；可直接传 UI 表单中的未保存配置。

行为：

- 尝试使用当前 host、port、user 和鉴权信息建立 SSH 连接，并在配置了日志路径时检查远程路径展开。

输出：

- `ok`：连接或路径检查是否成功。
- `message`：面向用户的测试结果说明。
- `filesCount`：找到的日志文件数量；未配置路径时为 `0`。

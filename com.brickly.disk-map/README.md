# 磁盘地图

status: active
type: brick
related_code: runtime/go/main.go, runtime/go/internal/walker, runtime/go/internal/tree, runtime/go/internal/scan, src/App.tsx, src/hooks/useDiskMap.ts, src/components/Pie.tsx, src/components/Treemap.tsx, src/chart-data.ts
last_verified: 2026-09-05

`com.brickly.disk-map` 是 macOS 专用的磁盘地图工具：打开窗口立刻看到卷用量，家目录（或自选目录）在后台流式长出目录树，用户可以下钻查看占用、把可删项放进暂存箱，统一移入废纸篓。不跟链、不跨卷、不碰快照删除。

## runtime 必须显式 `owned`

`runtime.instance` 是 `owned`：树只存在 Go 进程内存里，体验窗必须先 `await window.brickly.start()` 拿 Handle，再用 Handle 的 `invoke` / `call`。直接 `window.brickly.invoke` 会创建 Call 级临时 Lifetime，命令结束进程就被 SIGTERM，扫到一半的树就没了。

扫盘热路径走 Darwin `getattrlistbulk(2)`（`x/sys/unix` 的 `SYS_GETATTRLISTBULK` + 自写 attr buffer 解析），`CGO_ENABLED=0` 可交叉编译 `mac-arm64` / `mac-x64`。WalkDir 每个条目一次 `lstat`，bulk 一次 syscall 吃一整页目录项。解析失败或 syscall 不可用时该目录回退一次 `Readdirnames`+`Lstat`（共享 fd 目录偏移，不会整目录重复），打日志继续。

## 命令契约

| 命令 | 模式 | 作用 |
| --- | --- | --- |
| `volume` | invoke | 卷用量（Statfs）+ Purgeable（diskutil，尽力）+ 本地快照列表（tmutil，只读） |
| `scan` | call，`timeoutMs: 600000` | 流式扫描；只推进度与浅层节点，树留在 Go 内存 |
| `peek` | invoke | 下钻主路径：取某路径节点与直接孩子（top-64 + 「其他」桶） |
| `extstats` | invoke | 最近一次扫描按扩展名聚合的占用，按字节降序，最多 48 条 |
| `recipes` | invoke | 白名单固定大户探测（Xcode / Docker / 微信 / Telegram / Caches / 扫盘发现的 node_modules） |
| `trash` | invoke | protect 校验通过后逐项 `ShellTrashItem`，允许中途失败 |

页面侧：`scan` 用 `handle.call('scan', …, { signal, onEvent })` 收事件，取消走 `AbortController`。事件只有三种：

- `{ type: "progress", progress: { root, scannedFiles, scannedBytes, currentPath } }` — 最多每 150ms 一条；UI 从首条 progress 取根并设为当前路径，图表立即有根可画
- `{ type: "node", node }` — 只发扫描根的直接孩子，或深度 ≤2 且 ≥8MiB 的目录
- `{ type: "done", done: { root, scannedFiles, scannedBytes } }` — 收到后 UI 再 peek 一次根，把根层收齐

明细一律走 `peek(path)`。下钻的子树还没扫完时，等下一条 progress 再 peek 即可，不需要额外回传机制。

## 扫描与安全规则

- 默认根：`system.getPath("home")`；UI 可用 `window.brickly.fs.pickDirectory` 换根。不提供「扫描 /」入口。
- 不跟随符号链接（`kind=link`，allocated=0）；跨卷挂载点标 `mount`，不深入；`EACCES/EPERM` 标 `inaccessible`，继续扫。
- 硬链按 `(fsid, fileid)` 去重：同一 inode 只在首次出现时计入占用。
- `node_modules` / `.git` 是「巨叶」：目录计入父级，内部继续扫出大小但不展开成独立孩子层；`node_modules` 记入 recipes 结果。
- 内存树是目录树：目录节点 + 每层 top-64 文件摘要，其余折进「其他」桶。不做持久缓存：每次开窗直接流式扫描，树只存在本进程内存里，关窗即弃。
- `trash` 前必须过 protect：绝对路径要在扫描根或 recipe 命中之下；`/System`、`/usr`、`/bin`、`/sbin`、`/Library/Apple`、`/private/var/vm` 与扫描根本身是锁前缀；`protected` / `mount` / `inaccessible` 拒绝；Docker 在跑时拒绝回收 `Docker.raw`。页面不能绕过 runtime 直接 `shellTrashItem`。

## UI

`titleBar: "custom"` 自绘标题栏；布局为左侧图表面板、右侧面包屑 + 当前层列表，底部暂存箱。图表面板可在饼图（G2 interval + theta，引线标签）与矩阵树图（G2 `treemap` + `treemapSquarify`，叶子矩形）之间切换，共享选中与下钻状态。饼图为实心圆，当前目录占用显示在图下方（可点击返回上级）；饼图只画当前目录孩子，可用空间留在顶栏用量条。矩阵树图同样不画可用空间。底部扩展名图例展示 `extstats` 前 10 名（只读，不做过滤）。列表含占用与逻辑大小两列；`protected` / `mount` / `inaccessible` 的行不能加入暂存箱；「在访达中显示」走 `system.shellShowItemInFolder`。确认弹窗写明「硬链/克隆可能少于估计；进废纸篓可还原」。大量 `inaccessible` 时顶栏提示去系统设置开完全磁盘访问（不自动打开）。卷用量图例含总容量 / 已用 / 可清除 / 可用。

node 事件与 peek 结果都先写入 `NodeStore`，经 `requestAnimationFrame` 合并后再触发 React 重渲染。饼图用 AntV G2 `interval` + `theta`（占比 ≥3% 的扇区带 spider 引线标签），矩阵树图用 G2 `treemap`（只画叶子，`height === 0`）。中心返回上级是 HTML 覆盖层，下钻仍走 `peek`，关掉 G2 自带 drillDown。`prefers-reduced-motion` 时不做入场动画。

## 构建与验证

```bash
# Go 单测（attr 解析 / walker / tree / protect / volume / recipe / scan 门槛）
cd runtime/go && go test ./...

# UI 类型检查与构建（产物在 ui/）
npm run typecheck && npm run build
npm run test:ui

# 编译 runtime（mac-arm64 + mac-x64，CGO_ENABLED=0 可交叉）
./runtime/go/build.sh
```

本机导入手测路径：开窗 <1s 内出现用量条、随后边扫边出图（含扩展名图例）→ 饼图/矩阵树图切换 → 下钻后 Backspace / 面包屑 / 中心返回上级 → 扫描未到达的目录提示「扫描尚未到达此目录」→ 锁路径不能进暂存箱 → 确认后文件出现在废纸篓 → 关窗重开重新扫描、数据始终最新。

## 明确不做

- CGO / C++ / Objective-C：卷用量用 `statfs` + `diskutil`，与访达可能差几个 GB；不做 `NSURLVolumeAvailableCapacityForImportantUsageKey` 桥
- 快照删除与「一键瘦身」：`tmutil` 只读列快照
- 全盘扫描、跨卷、跟随符号链接、「未使用的 node_modules」启发式、微信/Telegram 媒体深度分类

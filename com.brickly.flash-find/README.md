---
status: active
type: brick-guide
related_code:
  - example-bricks/com.brickly.flash-find
last_verified: 2026-09-06
---

# 闪电搜索 Brick（Flash Find）

`com.brickly.flash-find` 是 macOS 全盘文件即输即搜 Brick——Windows `local-search`（Everything SDK）的 macOS 对等物。内嵌 [MacEverything](https://github.com/joshua-wu/MacEverything) C++20 引擎（MIT，vendor 在 `runtime/go/core/maceverything`，pin `26f0332c`）：getattrlistbulk 批量扫描 + name/path 双 trigram 倒排 + FSEvents 实时增量 + 磁盘缓存两阶段秒开 + ARM NEON 匹配。

## 架构

```
UI (React webview)  --window.brickly.invoke/call-->  Go runtime (brickly-sdk-go，协议接线人)
                                                          | cgo，窄 C ABI（ff_bridge）
                                                     MacEverything Core（进程内，无 HTTP/MCP/AI）
```

- **裁剪**：上游只保留 Core 引擎；HttpServer、MCP、AI（llama.cpp/Metal）全部移除，`ServiceEngine.{h,cpp}` 去掉了 `adminCallbacks`/`httpServer_`。
- **re2**：`regex:` 过滤依赖 re2，vendor `core/re2`（2022-12-01 tag，最后一个无 Abseil 依赖的版本，pin `4be24078`）。
- **ff_bridge**（`core/ffbridge`）：进程内 C ABI。铁律：C++ 异常不出边界（转 error JSON）；引擎回调只写原子计数器，Go 侧轮询，不做 cgo 回调。
- **Go runtime**：`search`（并行）/ `status`（Go 侧 500ms 节流轮询）/ `reindex` / `recent` + `quick-search`（宿主快捷搜索 files provider 后端）。进程启动即 `startIncremental`（命中缓存秒开，否则后台全量扫 `/`）。
- **UI**：即输即搜（120ms 防抖 latest-wins）、多词高亮、↑↓ 选择、Enter/双击在访达显示、复制路径、限定目录（映射 `path:` 过滤器）、扫描进度与重建入口。

## 运行行为

- 首次启动全盘扫描 `/`（跨挂载点不跟、.app 不下钻、(dev,ino) 去重），期间搜索可用但结果逐步完整；之后增量启动秒级就绪。
- 索引缓存在 `~/Library/Caches/com.brickly.flash-find/`（不占 brick storage 配额），日志在 `~/Library/Logs/com.brickly.flash-find/`。
- 引擎全机单实例锁是建议性的：与官方 MacEverything app 并存时互不阻塞，仅告警。
- 查询语法透传引擎：空格 = AND；`ext:` `size:` `path:` `parent:` `dm:` `regex:` `case:` `infile:`（内容索引）。

## 构建

```bash
# runtime（先编 C++ 静态库再 cgo 链接；arm64 为默认）
cd runtime/go && ./build.sh mac-arm64        # 或 mac-arm64,mac-x64
go test .                                    # 冒烟：临时目录扫描→就绪→搜索→path: 语法→recent

# UI
npm run setup && npm run build               # vite 产物进 ui/
npm run typecheck && npm run test:ui
```

`scripts/setup-brick.cjs` 的 `CGO_BRICKS` 已注册本 brick（构建走 `CGO_ENABLED=1`）。

## 已知边界

- `mac-x64` 二进制由 `clang -arch x86_64` 交叉编译产出，未在 Intel 机器实测。
- 搜索无分页：单次最多 1000 条（UI 默认 200）；引擎 `query()` 命中上限即提前返回。
- 内容索引（`infile:`）由引擎在扫描完成后自动后台构建，首次会有 CPU 占用高峰。
- 上游为个人项目（71 star），vendor 锁 commit 不追上游；问题自己 patch。

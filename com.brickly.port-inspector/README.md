---
status: active
type: brick-readme
related_code:
  - manifest.json
  - runtime/go/main.go
  - runtime/go/internal/nettable
  - runtime/go/internal/procinfo
  - src/App.tsx
last_verified: 2026-08-05
---

# 端口占用查询（Port Inspector）

`com.brickly.port-inspector` 用 **Go native runtime** 查询本机端口占用，并按 **PID** 查看详情 / 结束进程。

## 平台

- `win-x64` / `win-arm64`
- `mac-x64` / `mac-arm64`

## 生命周期

作者写 `runtime.instance: "per-call"`：每次查询独立进程，窗口关掉后不会在后台空转。

## 能力

| 命令 | 说明 | 审批 |
|------|------|------|
| `lookup` | 按端口查询 | 否 |
| `list` | 列表 + 过滤 | 否 |
| `details` | 按 PID 查看进程详情 | 否 |
| `kill` | 按 PID 结束进程 | 始终 |

## 引擎

| 平台 | 连接表 | 结束进程 |
|------|--------|----------|
| Windows | `GetExtendedTcpTable` / `GetExtendedUdpTable` | `TerminateProcess` API |
| macOS | `lsof -F` 结构化解析 | `kill(SIGTERM/SIGKILL)` |

## UI

固定暗色侦察台，强调色终端青，中文界面。点击表格行即可打开右侧进程详情。

体验窗使用 **`titleBar: "custom"`** 自绘标题栏（拖动区 + 最小化 / 最大化 / 关闭），依赖平台 `window.brickly.window`。

## 开发

```bash
npm install
npm run typecheck
npm run build
npm run build:runtime
npm run test:runtime
```

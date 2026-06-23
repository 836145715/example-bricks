# 网络抓包 Brick

status: draft
type: brick
related_code: manifest.json, src/App.tsx, runtime/go/main.go
last_verified: 2026-05-27

`com.brickly.net-capture` 是一个基于 SunnyNet 的本地抓包应用。UI 使用 React + Vite，native runtime 使用 Go 和 `brickly-sdk-go` 负责命令注册、事件发布、代理服务、限流发布和会话缓存。

## 平台支持

- Windows x64：支持普通系统代理模式，也保留 `Proxifier`、`NFAPI`、`TUN` 驱动模式入口。
- macOS x64 / arm64：支持普通系统代理模式，启动时可通过 SunnyNet 的 macOS `networksetup` 路径设置系统代理。
- macOS 当前不开放 SunnyNet 驱动模式。runtime 会在能力上报中把 `Proxifier`、`NFAPI`、`TUN` 标记为不可用，UI 会同步禁用这些选项，避免误触发路由或驱动级副作用。
- Linux 暂未在 manifest 中声明，后续需要独立验证系统代理、证书安装和 TUN 路由恢复后再开放。

## 抓包模式

- 默认使用普通 HTTP 代理模式，驱动保持关闭，启动时会自动设置系统代理，代理地址为 `http://127.0.0.1:<port>`。
- 用户可以在 UI 顶部的“驱动”下拉框中主动选择 `Proxifier`、`NFAPI` 或 `TUN`。
- 只有驱动模式不为 `关闭驱动` 时，Go runtime 才会调用 SunnyNet `OpenDrive`。
- 驱动模式可能需要管理员权限，也可能被安全软件拦截；启动失败时会返回明确错误，不会自动降级为驱动模式。
- runtime 会通过 `status.capabilities` 上报当前平台能力，UI 按能力禁用不支持的系统代理、证书或驱动操作。

## 性能策略

- Go runtime 使用有界队列接收 SunnyNet 回调，避免 UI 同步处理高频事件。
- 会话缓存采用环形上限，当前最多保留 12000 条。
- 事件通知按批次和时间窗口发布，renderer 侧再增量拉取列表。
- UI 只保留最近 3000 条、渲染最近 1200 条，避免长列表造成 webview 卡顿。

## 构建

```powershell
cd D:\ai-bricks\bricks\com.brickly.net-capture
npm run typecheck
npm run build
cd runtime\go
go test ./...
powershell -File build.ps1
```

macOS / Linux shell：

```bash
cd /path/to/ai-bricks/bricks/com.brickly.net-capture
npm run typecheck
npm run build
cd runtime/go
go test ./...
./build.sh mac-arm64 mac-x64
```

SunnyNet 在 Windows / macOS 上都包含 cgo 或系统 API 路径，因此构建脚本对该 runtime 启用 `CGO_ENABLED=1`。`build.ps1` 默认只构建 Windows 目标；macOS 目标优先在 macOS 机器上通过 `build.sh` 构建。macOS 证书安装通过 `security add-trusted-cert` 写入当前用户的 login keychain，系统可能弹出授权确认。

SunnyNet `src/public/constobj.go` 会在 package init 阶段向 stdout 打印 banner。Brickly native runtime 的 stdout 是 BPP JSON Lines 协议通道，不能混入普通文本；runtime 通过 `internal/stdoutguard` 在最早初始化阶段把普通 stdout 重定向到 stderr，并把原始 stdout 显式交给 `brickly-sdk-go` 作为协议通道，避免宿主报 `Invalid JSON line`。

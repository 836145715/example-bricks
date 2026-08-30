---
status: active
type: brick-readme
related_code:
  - manifest.json
  - runtime/win-x64/index.cjs
  - runtime/win-x64/services/share-service.cjs
  - runtime/win-x64/services/file-server.cjs
  - src/App.tsx
last_verified: 2026-07-29
---

# 内网文件共享

`com.brickly.lan-share` 是一个把本机目录通过 HTTP 共享到局域网的工具 Brick。宿主 service
进程负责承载 HTTP 文件服务，webview UI 负责配置、显式启停与状态展示。

## 服务生命周期

- 打开工具只读取宿主 service 状态，不会自动启动 runtime 或 HTTP 文件服务。
- 点击「启动共享」后，UI 先启动宿主 service，再启动 runtime 内的 HTTP 文件服务。
- 关闭工具窗口不会停止共享，宿主 service 与 HTTP 文件服务继续在后台运行。
- 点击「停止共享」后，UI 先停止 HTTP 文件服务，再停止宿主 service 进程。
- Brickly 主程序退出后不会保留共享；下次启动 Brickly 时也不会自动恢复。

UI 只在宿主 service 为 `running` 时调用 runtime 命令。共享目录、端口、上传开关和“是否已设置访问码”会缓存在 webview 的 `localStorage`，访问码明文不会写入该缓存；访问码输入留空时保留 runtime 中的原值。

## 能力边界

- `start` / `stop`：按配置启动 / 停止文件服务，绑定 `0.0.0.0:<端口>`。
- `status`：返回运行状态、端口、共享目录、内网访问 URL 列表与最近传输日志。
- `update-config`：持久化共享目录、端口、上传开关与访问码（不影响正在运行的实例）。
- `default-root`：返回推荐的默认共享目录（下载目录或用户主目录）。
- `list-entries`：在共享根内浏览子目录条目，供 UI 预览。
- `clear-log`：清空传输日志。
- `open-folder` / `open-url`：在系统文件管理器 / 默认浏览器中打开目录或访问地址。

访客侧网页支持：目录浏览、文件下载（`Range` 断点续传）、可选上传、可选访问码鉴权。

## 权限说明

- `net.http`、`net.tcp`：runtime 需要监听端口对外提供 HTTP 文件服务。
- `fs.read`：读取共享目录列表与文件内容用于下载。
- `fs.write`：仅在开启「允许上传」时，把访客上传的文件写入共享目录。

## 安全设计

- 所有访问路径经 `safe-path` 解析并夹紧在共享根目录内，杜绝目录穿越。
- 访问码通过 HTTP Basic Auth 校验，使用定长比较避免时序泄露；服务状态不回传访问码明文。
- 上传文件名经过清洗（去路径、去非法字符），重名时自动追加序号，不覆盖已有文件。
- 默认仅监听内网；UI 优先展示私有网段地址，并附带回环地址便于本机自测。

## 验证

```bash
npm install
cd runtime/win-x64 && npm install && cd ../..
npm run test:runtime
npm run test:ui
npm run typecheck
npm run build
```

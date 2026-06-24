---
status: active
type: brick-readme
related_code:
  - manifest.json
  - runtime/node/index.cjs
  - runtime/node/services/share-service.cjs
  - runtime/node/services/file-server.cjs
  - src/App.tsx
last_verified: 2026-06-24
---

# 内网文件共享

`com.brickly.lan-share` 是一个把本机目录通过 HTTP 共享到局域网的工具 Brick。常驻 service
runtime 负责起停文件服务，webview UI 负责配置与状态展示。

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
cd runtime/node && npm install && cd ../..
npm run test:runtime
npm run typecheck
npm run build
```

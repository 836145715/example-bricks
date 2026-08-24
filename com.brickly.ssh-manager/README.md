---
status: active
type: brick-guide
related_code:
  - example-bricks/com.brickly.ssh-manager
last_verified: 2026-08-24
---

# SSH Brick

`com.brickly.ssh-manager` 是 SSH 客户端。主功能是连上 Linux 机器、开交互终端。保存 Profile、一次性 `exec`、当前会话上的 SFTP 都是附加能力。

界面按 Tabby：整窗终端画布、顶栏 Tab、可收起 Profile 侧栏。SFTP 是当前 session 上的右侧抽屉，不是新工具。

它不和 `com.brickly.log-searcher` 共用主机库。配置写在 `~/.brickly/ssh-manager.json`，权限为当前用户可读写。`list-hosts` / `save-host` 的返回值不含密码、私钥或 passphrase；日志和诊断字段同样不会输出这些字段。

## 运行依赖

- Windows x64 或 macOS arm64。
- 远程主机是 Linux OpenSSH。
- 鉴权只支持密码或私钥（可选 passphrase）。

生命周期是 `stateful` + `runtime.instance: "owned"`。体验窗必须先 `window.brickly.start()` 钉住进程，再走 Handle 的 `invoke` / `interact`。直接 `window.brickly.invoke` / `stream` 会建 Call 级临时 Lifetime，命令结束就拆掉 Go 进程，PTY 和 SFTP 会断。Host↔Runtime 是 gRPC `invoke` / `interact`，不要再写 BPP。

`open-session`、`sftp-upload`、`sftp-download` 必须声明 `"mode": "interact"`。一条终端会话就是一条双工 `open-session`：调用方 `send({ type: "data" })` / `sendLatest("resize", …)`，Runtime `ctx.Send` 推 `session` / `data` / `cwd` / `status`。页面用 `nextEvent()` / `cancel()`，不要 `closeInput()`，也不要 `for await session.events`。关 Tab 用 `cancel()`，不要再调旁路命令。

体验窗使用 `ui.titleBar = "custom"`：宿主开无边框窗口并注入 `window.brickly.window`。标题栏和 Tab 合成一条，Tab 和窗口按钮必须 `no-drag`。打开工具先看到 Start Page，点 Profile 后终端铺满画布；编辑主机走浮层，exec 走底栏抽屉，SFTP 走右侧抽屉。前端状态是 `useReducer` + `SessionController` / `SftpController`，`SessionController` 持有 Interaction，不要把 interact 会话塞回 React state。

## 构建

```powershell
cd D:\brick-project\example-bricks\com.brickly.ssh-manager\runtime\go
.\build.ps1

cd D:\brick-project\example-bricks\com.brickly.ssh-manager
npm install
npm run build
```

macOS arm64：

```bash
cd example-bricks/com.brickly.ssh-manager/runtime/go
./build.sh
```

修改 Go runtime 后必须重新运行对应平台的 build 脚本，否则 `bin/` 下仍是旧二进制。

## 命令

- `list-hosts`：列出或按关键词过滤主机。返回公开档案（`hasPassword` / `hasKey`），不含密钥。
- `save-host` / `delete-host`：增改删主机。更新时密码、私钥、passphrase 留空则保持原值。
- `test-connection`：测试登录，可传 `hostId` 或未保存的 `host`。
- `exec`：执行一条远程命令，返回 stdout / stderr / exitCode。适合 Agent 或工作流一次性调用。
- `open-session`：打开双工交互 PTY。输入事件：`{ type: "data", encoding: "base64", bytes }`、`{ type: "resize", cols, rows }`（resize 用 `sendLatest`）、`{ type: "cwd" }`（立刻重读当前目录）。输出事件：`session`、`data`、`cwd`、`status`。开会话时用 POSIX 包装记下 shell PID；cwd 优先解析 OSC 7，缺席时在启动和每次回车后读 `/proc/<pid>/cwd`，不把钩子打进终端。
- `sftp-list`：列出远端目录；`path` 为空时返回家目录。传入 `sessionId` 时必须对应仍存活的终端会话。
- `sftp-upload`：上传本机文件或目录，通过 interact 事件输出 `progress`。传输期间即使关掉终端 Tab，也不会拆掉这条 SSH 连接。
- `sftp-download`：下载远端文件或目录，通过 interact 事件输出 `progress`。

## 一期边界

- SFTP 只做列目录、上传、下载和上传进度。不做新建、重命名、删除、chmod、远程编辑。
- 不做双向目录同步、跳板机、端口转发。
- 不做证书登录、二次验证、Windows 远程。
- 不做 known_hosts 严格校验（当前忽略 host key）。
- 不做常用命令库、登录自动脚本。
- 文件管理「追踪」订阅 Runtime 推送的 `cwd` 事件。默认靠回车后读 Linux `/proc/<pid>/cwd`；远端若发 OSC 7 会立即更新。非 Linux 或 `su`/`sudo -i` 后可能不同步。

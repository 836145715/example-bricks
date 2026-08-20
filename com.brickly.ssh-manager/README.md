---
status: active
type: brick-guide
related_code:
  - example-bricks/com.brickly.ssh-manager
last_verified: 2026-08-20
---

# SSH Brick

`com.brickly.ssh-manager` 是 SSH 客户端。主功能是连上 Linux 机器、开交互终端。保存 Profile、一次性 `exec`、当前会话上的 SFTP 都是附加能力。

界面按 Tabby：整窗终端画布、顶栏 Tab、可收起 Profile 侧栏。SFTP 是当前 session 上的右侧抽屉，不是新工具。

它不和 `com.brickly.log-searcher` 共用主机库。配置写在 `~/.brickly/ssh-manager.json`，权限为当前用户可读写。日志和诊断字段不会输出密码、私钥或 passphrase。

## 运行依赖

- Windows x64 或 macOS arm64。
- 远程主机是 Linux OpenSSH。
- 鉴权只支持密码或私钥（可选 passphrase）。

生命周期是普通 `stateful` 会话。自定义界面通过 `window.brickly.invoke` / `window.brickly.stream` 调用命令。Go runtime 使用 SDK 默认 BPP 版本，不要写死 `0.2.0`。

体验窗使用 `ui.titleBar = "custom"`：宿主开无边框窗口并注入 `window.brickly.window`。标题栏和 Tab 合成一条，Tab 和窗口按钮必须 `no-drag`。打开工具先看到 Start Page，点 Profile 后终端铺满画布；编辑主机走浮层，exec 走底栏抽屉，SFTP 走右侧抽屉。前端状态是 `useReducer` + `SessionController` / `SftpController`，不要把 stream handle 再塞回 React state。

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

- `list-hosts`：列出或按关键词过滤主机。
- `save-host` / `delete-host`：增改删主机。
- `test-connection`：测试登录，可传 `hostId` 或未保存的 `host`。
- `exec`：执行一条远程命令，返回 stdout / stderr / exitCode。
- `open-session`：打开交互 PTY，流式输出 `data` chunk（base64）。开会话时用 POSIX 包装记下 shell PID，不把钩子打进终端。
- `write-session` / `resize-session` / `close-session`：写入、改尺寸、关闭会话。
- `session-cwd`：在已打开的 SSH 连接上读 shell 的 `/proc/<pid>/cwd`（优先复用 SFTP 通道）。文件管理「追踪」在打开时读一次，之后每次终端回车后再读。
- `sftp-list`：列出远端目录；`path` 为空时返回家目录。
- `sftp-upload`：上传本机文件或目录，流式输出 `progress`。
- `sftp-download`：下载远端文件或目录，流式输出 `progress`。

## 一期边界

- SFTP 只做列目录、上传、下载和上传进度。不做新建、重命名、删除、chmod、远程编辑。
- 不做双向目录同步、跳板机、端口转发。
- 不做证书登录、二次验证、Windows 远程。
- 不做 known_hosts 严格校验（当前忽略 host key）。
- 不做常用命令库、登录自动脚本。
- 文件管理「追踪」读取 Linux `/proc/<pid>/cwd`，不向终端注入 `PROMPT_COMMAND`。非 Linux 或 `su`/`sudo -i` 后可能不同步。

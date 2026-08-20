# SSH 客户端 SFTP 一期设计

`com.brickly.ssh-manager` 的主功能是 SSH：连上 Linux 机器，用交互终端做事。保存主机、SFTP 都是附加能力，挂在当前这条 SSH 会话上，不新开积木。

本文只定一期。一期做完，用户能把本机文件传到当前机器，也能把远端文件拉回来。

## 目标

- 同一条 SSH 登录下提供远端文件通道：列目录、上传、下载。
- **上传必须有可见进度**：当前文件、已传/总字节、百分比；目录上传还要有「第几个文件 / 共几个」。
- 终端画布支持拖入文件，以及 `Ctrl+V` 粘贴本机文件 / 本机路径后上传。
- Agent 或工作流可以不打开面板，直接 `invoke` 这三条命令，并从 stream 读同样的 `progress`。
- 不把产品做成文件管理器或同步盘。

## 非目标

- 新建、重命名、删除、chmod、远程编辑。
- 双向目录同步、定时同步、冲突合并。
- 跳板机、端口转发、Windows 远程、证书登录、2FA。
- 从终端输出里猜测当前工作目录（不解析 OSC 7，不扫 `pwd`）。
- 新积木、新宿主协议、改 BPP。
- 和 `com.brickly.log-searcher` 共用主机库。

## 产品位置

```text
SSH 终端（主）
  ├─ 已保存的 Profile（附加，现有）
  ├─ 一次性 exec（附加，现有）
  └─ SFTP 列目录 / 上传 / 下载（附加，本期）
```

SFTP 是当前会话上的抽屉，不是新的工具入口，也不是新的 Tab 类型。没有已连接的 session 时，也可以按 `hostId` 做一次短连接传文件，方便 Agent 调用。

## 选定方案

远端走 SFTP 子系统，不走 `scp` 命令，也不把文件内容 `cat` 进 PTY。

```text
UI 拖入 / 粘贴 / 点选
  -> 解析成本机绝对路径列表
  -> invoke / stream：sftp-list | sftp-upload | sftp-download
  -> runtime 用同一套 host 鉴权打开 ssh.Client
  -> pkg/sftp 列目录或流式读写
  -> 进度 chunk 回 UI
```

选择该方案的原因：

- 和现有密码 / 私钥登录同一条鉴权路径，不复制主机库。
- SFTP 是独立通道，不会把二进制文件写进终端会话。
- Go 侧用 `github.com/pkg/sftp` 即可，不改宿主。
- 拖拽和粘贴只负责收集本机路径；真正读写文件在 runtime，权限边界仍是 `fs.read` / `fs.write`。

连接复用：

- 若该 `hostId` 已有打开的终端 session，runtime **应该**复用那个 `ssh.Client` 再开 SFTP。
- 若没有打开的 session，为这一次文件操作新建短连接，完成后关掉。
- 一期允许先实现「每次文件操作单独拨号」，但命令契约必须已经带可选 `sessionId`，避免二期改 API。

## 远端路径规则

- 默认远端目录是该用户家目录。第一次 `sftp-list` 不传 `path` 时，runtime 解析 `~` 并返回真实绝对路径。
- 之后以 SFTP 面板当前目录为准。
- 拖到终端上时：用该 Tab 的 SFTP 当前目录；面板没打开过则用家目录。
- 一期不跟踪 shell 的 `cwd`。状态栏或确认条必须写出将要写入的远端目录，避免用户以为传到了终端所在目录。
- 路径分隔一律按远端 Linux：`/`。本机 Windows 路径只出现在 `localPath`。
- 拒绝远端路径里的 `..` 逃出用户指定的目录前缀不是本期目标；但仍拒绝空路径、NUL、以及把远端路径解析成本机盘符。

覆盖策略：

- 默认不覆盖。目标已存在则失败，并返回已存在路径。
- UI 在用户确认后带 `overwrite: true` 重试。
- 同名目录与同名文件冲突：失败，不静默合并。

## 本机路径从哪里来

只接受本机绝对路径。UI 不把文件内容读进前端再 base64 丢给 runtime。

| 来源 | 行为 |
| --- | --- |
| 拖入文件 | 从 `dataTransfer.files` 取 Electron 文件路径（现有积木用的 `getPathForFile` 同类方式）。 |
| 拖入文件夹 | 一期支持。runtime 递归上传，远端按相对结构建目录。 |
| `Ctrl+V` 且剪贴板是文件 | `os.clipboard` 读到 `kind: file` 后用 `paths`。 |
| `Ctrl+V` 且剪贴板是文本 | 默认仍写给 PTY，不拦截普通粘贴。 |
| 路径同步 | 仅当文本是**一条**已存在的本机绝对路径（文件或目录）时，弹出确认「上传这个路径」；用户取消则按普通文本粘贴。多行文本不当路径。 |
| 剪贴板图片 | 一期不做。 |

`Ctrl+V` 判定顺序：

1. 剪贴板是文件列表 → 走上传确认，不写 PTY。
2. 剪贴板是单行本机路径且该路径存在 → 弹出确认；确认后上传，取消则写 PTY。
3. 其余文本 → 写 PTY（终端聚焦时）或忽略（SFTP 面板聚焦且不是路径）。

SFTP 面板聚焦时，文本路径确认后直接上传，没有 PTY 可写。

## 命令契约

权限：现有 `fs.read`、`fs.write`、`net.tcp`，新增 `os.clipboard`。剪贴板只给 UI 读本机文件路径，不把密钥放进剪贴板。

### `sftp-list`

短命令。列出一个远端目录。

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| `hostId` | 是 | 已保存主机。 |
| `sessionId` | 否 | 有则尽量复用该 session 的 SSH 连接。 |
| `path` | 否 | 远端目录。空则家目录。 |

输出：

```json
{
  "path": "/home/alice",
  "entries": [
    {
      "name": "app.log",
      "path": "/home/alice/app.log",
      "kind": "file",
      "size": 1200,
      "mtimeMs": 1720000000000,
      "mode": "0644"
    }
  ]
}
```

`kind` 只区分 `file` / `dir`。符号链接按目标类型展开失败时标 `file`，并带 `link: true`。不递归。

### `sftp-upload`

流式命令。把一个本机文件或目录传到远端目录。

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| `hostId` | 是 | |
| `sessionId` | 否 | |
| `localPath` | 是 | 本机绝对路径。 |
| `remoteDir` | 否 | 远端目录，默认家目录。 |
| `overwrite` | 否 | 默认 `false`。 |

多个本机项由 UI 串行多次调用，不在一条命令里塞路径数组，便于单条失败后继续。

`sftp-upload` **必须是 streaming 命令**。禁止等全部传完再给一个结果：大文件和目录在传的过程中就要推进度。

流式输出顺序：

1. 先发一条 `progress`，`phase` 为 `connecting` 或 `scanning`（目录先扫总大小）。
2. 开始写文件后反复发 `progress`，`phase` 为 `upload`。
3. 成功结束发 `result`：`{ ok, remotePath, bytes }`。失败走命令错误，最后一条 `progress` 的 `phase` 可以是 `error`。

`progress` 字段：

```json
{
  "phase": "upload",
  "bytes": 1048576,
  "totalBytes": 10485760,
  "percent": 10,
  "currentPath": "D:\\\\logs\\\\app.log",
  "remotePath": "/home/alice/app.log",
  "fileIndex": 1,
  "fileCount": 3,
  "fileBytes": 1048576,
  "fileTotalBytes": 5242880
}
```

| 字段 | 说明 |
| --- | --- |
| `bytes` / `totalBytes` | 这一次命令里已传/总共字节。目录上传是整棵树合计。 |
| `percent` | `totalBytes > 0` 时由 runtime 算整型 0–100，避免 UI 各算各的。扫不到总大小时省略，UI 只显示已传字节。 |
| `currentPath` | 正在传的本机文件。 |
| `remotePath` | 对应远端路径，给状态栏展示。 |
| `fileIndex` / `fileCount` | 目录上传用，从 1 计。单文件则为 `1/1`。 |
| `fileBytes` / `fileTotalBytes` | 当前这个文件的进度。 |

节流：同一条命令的 `progress` 最多约每 100ms 一条，或每写满 256KiB 一条，取先到者。必须额外保证：

- 每个文件开始时发一条（`fileBytes = 0`）。
- 每个文件结束时发一条（`fileBytes = fileTotalBytes`）。
- 整次命令结束前发一条 `percent = 100`（若有总大小）。

不要每个 TCP 包都推一条。暂停、断点续传仍是二期；一期进度是只读的。

超时：单文件默认 10 分钟，目录按文件数可更长，上限 60 分钟。manifest `timeoutMs` 取上限。

### `sftp-download`

流式命令。把一个远端文件或目录拉到本机目录。

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| `hostId` | 是 | |
| `sessionId` | 否 | |
| `remotePath` | 是 | 远端绝对路径。 |
| `localDir` | 是 | 本机目录。一期不默认猜测下载目录，由 UI 记住上次选择。 |
| `overwrite` | 否 | 默认 `false`。 |

输出与 upload 对称：`progress` + `result`。`phase` 为 `download`。

本机写入必须落在用户给出的 `localDir` 下，文件名取远端 basename。目录下载保持相对结构。

## 界面

主画布仍是终端。SFTP 是当前 session Tab 上的侧栏或底栏抽屉，和现有 exec 抽屉同类，默认收起。

打开抽屉后：

- 顶部是远端当前路径，可点面包屑回退。
- 主体是当前目录列表，文件显示大小。
- 选中文件或目录后可以下载。
- 列表区域也是拖放目标。

拖到终端（抽屉关着也可以）：

1. 出现遮罩：`上传到 /home/alice`，列出文件名。
2. 松手即开始传；Esc 或拖出取消。
3. 上传开始后遮罩换成进度条，**不挡住终端输入**：底部一条即可，终端继续可打字。
4. 进度条至少显示：远端目录、当前文件名、`percent`、`已传 / 总大小`。目录上传再加 `第 fileIndex / fileCount 个`。
5. 状态栏同步同一句话，例如 `上传 app.log  3.2 MB / 12 MB  27%`。
6. 多条本机项串行时，进度条跟着当前这一条命令走；上一条 100% 后再开下一条，不要几条进度叠在一起无法读。

进度条在成功后短留约 1 秒再收起。失败则停在出错文件，文案改成错误原因，不假装传完。

下载：

- 第一次下载必须选本机目录。
- 之后默认用该 Tab 记住的目录，状态栏可改。

失败时状态栏给一句人话，例如「远端已存在 app.log」或「权限不足」。不弹系统级模态挡住终端。覆盖确认可以用轻量对话框。

Start Page 未连接时不提供拖放上传。用户必须先打开一个 session，或以后由 Agent 直接带 `hostId` 调用命令。

## 安全与日志

- 继续：日志、状态栏、错误对象不输出密码、私钥、passphrase。
- 本机路径和远端路径可以进错误信息，方便排障。
- 不在前端展示密钥。
- 上传前 runtime 必须确认 `localPath` 是绝对路径且存在；下载前必须确认 `localDir` 存在或可创建。
- 一期仍忽略 host key，与现有 SSH 登录一致。不在本期改 known_hosts。

## 测试

Go runtime 用内存或临时目录 + 假 SFTP 后端测这些不变量：

- 空 `path` 的 `sftp-list` 回到家目录。
- 上传文件后列表里能看到同名、同样大小。
- 默认不覆盖；`overwrite: true` 才替换。
- 目录上传保持相对结构。
- 下载不会写到 `localDir` 外面。
- 错误返回不含密码或私钥文本。
- 上传过程中至少收到：开始一条、中间至少一条（文件大于 256KiB 时）、结束一条 `percent = 100`。
- `progress` 不含密码、私钥、passphrase。

前端测路径收集，不测真实 SSH：

- 拖入能拿到绝对路径。
- 剪贴板文件走上传，剪贴板普通文本仍进终端。
- 单行存在的本机路径会确认，多行文本不会。

## 二期（本文不实现）

- 新建 / 重命名 / 删除 / chmod。
- 传输队列、暂停、取消、断点续传（一期只显示进度，不能暂停）。
- 远程打开编辑后回传。
- 复用同一 `ssh.Client` 的多路 SFTP（若一期先单独拨号）。
- 用 OSC 7 对齐终端 cwd。
- 剪贴板图片另存再传。

## 落地时要改的文件

- `example-bricks/com.brickly.ssh-manager/manifest.json`：加 `os.clipboard` 和三条命令。
- Go runtime：SFTP 客户端、路径规则、进度流。
- 前端：SFTP 抽屉、拖放遮罩、粘贴分流、下载目录记忆、上传进度条。
- `example-bricks/com.brickly.ssh-manager/README.md`：主功能改成 SSH 客户端，去掉「不做 SFTP」，改为一期边界。

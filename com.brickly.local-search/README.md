---
status: active
type: brick-guide
related_code:
  - bricks/com.brickly.local-search
last_verified: 2026-08-19
---

# 本地搜索 Brick

`com.brickly.local-search` 是 Windows x64 本地文件搜索 Brick，使用 Go native runtime 直接动态加载 Everything SDK 的 `Everything64.dll`，并通过自定义 Webview 提供分类、分页、排序、文件操作和受限文件预览界面。同时它通过 `manifest.quickSearch.providers` 贡献 `files` provider，可在宿主 Quick Search 搜索条里返回轻量文件结果。

## 运行依赖

- Windows x64。
- 捆绑目录 `runtime/win-x64/` 必须包含 `Everything64.dll`、`Everything.exe`。`Everything.lng` 只是界面语言包，可有可无。
- 不再扫描用户本机的 Everything 安装。打开工具时若索引通道未接通，会以后台管理员实例启动自带的 `Everything.exe -admin -startup -instance Brickly`，避免弹出 NTFS 权限三选一对话框。Windows 仍可能出现一次 UAC。
- 索引未完成时只显示 loading，`Everything_IsDBLoaded` 为真后再搜索。

生命周期是普通 `stateful` 会话，不是 `lifecycle.service`。索引由捆绑的 Everything 实例持有；Brick 只在窗口/调用会话里加载 DLL 并查询。

自定义界面通过宿主注入的 `window.brickly.invoke` / `window.brickly.system` 调用命令和打开文件，不再自行拼 `bridge.invoke` 字符串身份。Go runtime 使用 SDK 默认 BPP 版本（当前 `0.4.0`），不要再写死 `0.2.0`。

体验窗使用 `ui.titleBar = "custom"`：宿主开无边框窗口并注入 `window.brickly.window`（最小化 / 最大化 / 关闭）。界面自绘 36px 标题栏，拖动区用 `-webkit-app-region: drag`，按钮区必须 `no-drag`。改完 titleBar 后需要关掉再打开工具窗口才会生效。

## 构建

```powershell
cd D:\brick-project\example-bricks\com.brickly.local-search\runtime\go
.\build.ps1

cd D:\brick-project\example-bricks\com.brickly.local-search
npm run build
```

## 命令

- `health`：检查捆绑 SDK / Everything，必要时后台拉起 `-instance Brickly`。`reason` 为 `ready` / `not_installed` / `not_running` / `indexing` / `ipc_unavailable` / `missing_sdk` / `unsupported`。
- `search`：按关键词、分类、分页和排序查询 Everything 索引；索引未就绪时直接拒绝。
- `preview`：按受限大小读取文件预览信息，支持文本/代码、图片、PDF、音视频、ZIP/JAR/EPUB 目录、DOCX/DOCM 渲染、RTF 文本和 XLSX 表格前几行。
- `quick-search`：隐藏命令，供宿主快速搜索调用；输入 `{ providerId, query, sequence, limit }`，输出 `{ results }`，结果只包含标题、路径、类别、去重键和主进程激活缓存所需的 `activationData.path`。索引未就绪时返回空结果。
- `quick-search-open`：隐藏命令，供宿主激活快速搜索结果；只接受缓存结果中的本地绝对路径，并通过 Windows Shell 打开文件或文件夹。

修改 Go runtime 后必须重新运行 `runtime/go/build.ps1`，否则 `runtime/win-x64/brick.exe` 仍不会包含新的快速搜索命令。

## 预览边界

- 文本类文件只预览前 20 KiB，runtime 硬限制同为 20 KiB；二进制内容会停止文本预览。
- 图片、PDF、音视频通过 `file:` URL 交给 Webview 内嵌控件渲染，不把大文件内容传回前端。
- ZIP 类文件只读取目录信息，不解压到磁盘。
- DOCX/DOCM 默认交给 Webview 里的 `docx-preview` 渲染；超过 8 MiB 或渲染失败时，回退到 `word/document.xml` 纯文本。
- RTF 只做受限纯文本提取；XLSX 仅解析前几个工作表的前若干行。
- 旧版 Office 二进制格式、RAR/7z/tar/gz/xz/iso 和文件正文全文预览暂不支持。

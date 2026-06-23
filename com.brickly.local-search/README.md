---
status: active
type: brick-guide
related_code:
  - bricks/com.brickly.local-search
last_verified: 2026-06-09
---

# 本地搜索 Brick

`com.brickly.local-search` 是 Windows x64 本地文件搜索 Brick，使用 Go native runtime 直接动态加载 Everything SDK 的 `Everything64.dll`，并通过自定义 Webview 提供分类、分页、排序、文件操作和受限文件预览界面。同时它通过 `manifest.quickSearch.providers` 贡献 `files` provider，可在宿主 Quick Search 搜索条里返回轻量文件结果。

## 运行依赖

- Windows x64。
- 本机已安装并运行 Everything 客户端。
- `vendor/win-x64/Everything64.dll` 存在。

## 构建

```powershell
cd D:\ai-bricks\bricks\com.brickly.local-search\runtime\go
.\build.ps1

cd D:\ai-bricks\bricks\com.brickly.local-search
npm run build
```

## 命令

- `health`：返回平台、Go runtime、DLL 路径和 Everything IPC 状态。
- `search`：按关键词、分类、分页和排序查询 Everything 索引。
- `preview`：按受限大小读取文件预览信息，支持文本/代码、图片、PDF、音视频、ZIP/JAR/EPUB 目录、DOCX/DOCM 渲染、RTF 文本和 XLSX 表格前几行。
- `quick-search`：隐藏命令，供宿主快速搜索调用；输入 `{ providerId, query, sequence, limit }`，输出 `{ results }`，结果只包含标题、路径、类别、去重键和主进程激活缓存所需的 `activationData.path`。
- `quick-search-open`：隐藏命令，供宿主激活快速搜索结果；只接受缓存结果中的本地绝对路径，并通过 Windows Shell 打开文件或文件夹。

修改 Go runtime 后必须重新运行 `runtime/go/build.ps1`，否则 `bin/win-x64/brick.exe` 仍不会包含新的快速搜索命令。

## 预览边界

- 文本类文件只预览前 20 KiB，runtime 硬限制同为 20 KiB；二进制内容会停止文本预览。
- 图片、PDF、音视频通过 `file:` URL 交给 Webview 内嵌控件渲染，不把大文件内容传回前端。
- ZIP 类文件只读取目录信息，不解压到磁盘。
- DOCX/DOCM 默认交给 Webview 里的 `docx-preview` 渲染；超过 8 MiB 或渲染失败时，回退到 `word/document.xml` 纯文本。
- RTF 只做受限纯文本提取；XLSX 仅解析前几个工作表的前若干行。
- 旧版 Office 二进制格式、RAR/7z/tar/gz/xz/iso 和文件正文全文预览暂不支持。

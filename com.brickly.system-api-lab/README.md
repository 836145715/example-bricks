# System API 实验室

`com.brickly.system-api-lab` 是用于验证 Brick UI preload 与 Node runtime System API 对齐情况的示例 Brick。

它同时覆盖两条调用链：

- **UI preload facade**：页面直接调用 `window.brickly.system.*`。
- **Runtime SDK**：页面通过 `window.brickly.invoke('run-system-suite')` 调用 Node runtime，runtime 内部使用 `ctx.platform.system.*`。

示例还包含 `preload/system-lab-preload.cjs`，用于验证自定义 preload 的 Node.js 能力。页面本身不直接获得 Node、Electron 或 `ipcRenderer`，只使用 preload 暴露的 `window.systemLabNode` 创建安全的临时测试文件。

## 测试范围

默认测试会调用：

- `getAppName()`
- `getAppVersion()`
- `getNativeId()`
- `isDev()`
- `isMacOS()`
- `isWindows()`
- `isLinux()`
- `getPath(name)` 的全部支持路径
- `getFileIcon('.txt')`
- `getFileIcon('folder')`
- `getFileIcon(tempFile)`
- `readCurrentFolderPath()`，macOS Finder / Windows Explorer 前台窗口可返回路径；其他场景可能返回错误
- `readCurrentBrowserUrl()`，当前预留接口，通常返回 `UNSUPPORTED_PLATFORM`

界面上可手动勾选额外副作用测试：

- `showNotification()`：发送系统通知。
- `shellBeep()`：播放系统提示音。
- `shellOpenExternal()`：打开 uTools system API 文档。
- `shellOpenPath()`：打开示例创建的临时文本文件。
- `shellShowItemInFolder()`：在文件管理器中定位临时文本文件。
- `shellTrashItem(tempFile)`：把示例临时文件移入废纸篓。
- `brickly.fs.pickDirectory()`：弹出目录选择器。

另外声明了一个默认不启用的测试热键：

- `log-current-folder-path`：默认建议绑定 `Command+Alt+Shift+P` / `Control+Alt+Shift+P`，触发后只调用 `ctx.platform.system.readCurrentFolderPath()`，并把结果或错误输出到 runtime 控制台。

## 使用方式

1. 在 Brickly 开发环境中加载根目录 `bricks/` 示例。
2. 打开 **System API 实验室**。
3. 点击 **运行 UI 测试** 或 **运行 Runtime 测试**。
4. 根据需要勾选“打开链接”“打开文件”“定位文件”“全量含选目录”等额外选项。

## 设计说明

- UI 和 runtime 共用同一份测试意图，便于观察 `window.brickly.system.*` 与 `ctx.platform.system.*` 是否对齐。
- Runtime 使用 `lifecycle.mode: "task"`，每次测试都启动新的 runtime 进程，避免诊断结果被旧缓存代码影响。
- `shellTrashItem()` 只作用于示例创建的临时文件，避免影响用户真实文件。
- 测试面板只按实际调用结果展示状态：成功就是 `ok`，失败就是 `error`。平台差异通过返回值或错误码判断，不在面板里伪装成通过。
- 未勾选的副作用测试不会写入报告列表，避免把“未执行”展示成第三种状态。
- `getPath('recent')` 在 Windows 等支持环境中可正常返回路径；在部分平台或 Electron 环境中不支持时会返回 `UNSUPPORTED_PLATFORM`。
- `readCurrentFolderPath()` 依赖 native system helper；在 Linux 等平台不支持时会返回 `UNSUPPORTED_PLATFORM`，当前前台窗口不是文件管理器或没有可读文件夹时会返回 `CURRENT_FOLDER_UNAVAILABLE`，helper 未构建时会返回 `BINARY_MISSING`。
- runtime manifest 声明了 `os.notification`、`os.exec`、`os.env`、`fs.read`，用于覆盖 runtime 权限网关。
- UI preload 调用 system IPC 不做 manifest 权限拦截；示例仍声明这些权限，以便 runtime 链路完整测试。

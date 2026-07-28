# 占用探针（Hold Probe）

Windows 专用 Brick：探测**文件或文件夹**当前被哪些进程占用。

与仓库内其它占用类示例独立实现，便于横向对比探测策略与交互设计。

## 能力

- 输入完整路径，或选择文件 / 文件夹，或拖放目标
- **纯 Win32/NT API 探测**（不依赖 PowerShell / 外部工具）
- 目录/工作区占用通过进程命令行、映像路径、工作目录匹配
- 可选「深度扫描」做系统句柄枚举（较慢）
- 查看进程详情；经审批后结束进程（可选强制）

## 探测引擎（Win32）

| 来源 | API | 场景 |
|------|-----|------|
| Restart Manager | `RmStartSession` / `RmRegisterResources` / `RmGetList` | 文件被打开占用 |
| 进程引用 | `CreateToolhelp32Snapshot`、`QueryFullProcessImageNameW`、`NtQueryInformationProcess(ProcessCommandLineInformation)`、PEB+`ReadProcessMemory`（当前目录） | 文件夹/IDE 工作区 |
| 句柄扫描（可选） | `NtQuerySystemInformation(SystemExtendedHandleInformation)`、`DuplicateHandle`、`NtQueryObject` | 深层打开句柄 |

## 平台

仅 `win-x64` / `win-arm64`。

## 命令

| 命令 | 说明 | 审批 |
|------|------|------|
| `probe` | 探测占用 | 否 |
| `process-info` | 进程详情 | 否 |
| `stop` | 结束进程 | 始终 |

## 开发

```powershell
npm install
npm run typecheck
npm run build
npm run build:runtime
npm run test:runtime
```

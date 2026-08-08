# 占用探针（Hold Probe）

跨平台 Brick：探测 Windows 或 macOS 上**文件或文件夹**当前被哪些进程使用。

与仓库内其它占用类示例独立实现，便于横向对比探测策略与交互设计。

## 能力

- 输入完整路径，或选择文件 / 文件夹，或拖放目标
- Windows 使用 Win32/NT API，macOS 使用系统自带 `/usr/sbin/lsof`
- 文件、目录、进程工作目录和打开句柄使用情况探测
- 可选「深度扫描」递归检查子目录（较大的目录可能较慢）
- 查看进程详情；经审批后结束进程（可选强制）

## 探测引擎

| 平台 | 来源 | 场景 |
|------|------|------|
| Windows | Restart Manager、进程引用、NT 句柄枚举 | 文件锁、目录引用、深层打开句柄 |
| macOS | `lsof -F0` 结构化输出 | 文件描述符、工作目录、可执行文件和目录内容 |

macOS 普通目录扫描使用 `+d`，深度扫描使用 `+D`，并设置超时。结果是瞬时快照，且可能受系统权限限制。

## 平台

- `win-x64` / `win-arm64`
- `mac-x64` / `mac-arm64`

## 命令

| 命令 | 说明 | 审批 |
|------|------|------|
| `probe` | 探测占用 | 否 |
| `process-info` | 进程详情 | 否 |
| `stop` | 结束进程 | 始终 |

## 开发

```bash
npm ci
npm run typecheck
npm run build
npm run build:runtime
npm run test:runtime
```

`npm run build:runtime` 默认构建当前平台和架构。构建完整矩阵：

```bash
node runtime/go/build.mjs win-x64,win-arm64,mac-x64,mac-arm64
```

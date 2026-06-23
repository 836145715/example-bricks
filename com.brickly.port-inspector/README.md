---
status: active
type: brick-readme
related_code:
  - manifest.json
  - runtime/node/index.cjs
  - runtime/node/services/port-inspector.cjs
  - src/App.tsx
last_verified: 2026-06-08
---

# 端口占用查询

`com.brickly.port-inspector` 是一个开发者工具 Brick，用于查询本机端口被哪个进程占用，并在用户确认后结束进程。

## 能力边界

- `lookup`：按端口号查询占用记录，返回协议、本地地址、端口、状态、PID、进程名称。
- `list`：列出端口占用记录，可按端口、PID 或进程名过滤。
- `details`：按 PID 查看进程详情，返回进程名称、可执行路径、启动参数、工作目录、父进程、用户和运行时间等只读信息。
- `kill`：按 PID 结束进程，UI 会先弹出确认框；LLM 调用声明为 `requireApproval: always`。

## 权限说明

本 Brick 声明 `os.exec`，因为 runtime 需要调用系统命令：

- Windows：`netstat.exe`、`taskkill.exe`，并用 `wmic.exe` 或 PowerShell 查询进程名和进程详情。
- macOS：`lsof`、`ps`、`kill`。
- Linux：`ss`、`ps`、`kill`。

查询端口是只读操作；结束进程是高风险副作用操作，应只在用户明确确认后执行。

## 验证

```bash
npm run test:runtime
npm run typecheck
npm run build
```

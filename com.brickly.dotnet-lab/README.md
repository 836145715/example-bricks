# com.brickly.dotnet-lab

.NET 8 原生 Brick 示例：invoke、interact 流式事件、会话内 request 与资源读写。

## 前置

- .NET 8 SDK（构建）与 **ASP.NET Core 8 运行时**（运行；`dotnet --list-runtimes` 应含 `Microsoft.AspNetCore.App 8.x`）

## 构建

```bash
node ../scripts/setup-brick.cjs .
# 或本地 SDK 联调：
npm run setup -- --local
```

产物在 `runtime/<platform>/brick(.exe)`，与 `manifest.json` 的 `runtime.entry` 对应。

## 命令

| id | mode | 说明 |
| --- | --- | --- |
| `hello` | invoke | 返回问候语与 SDK 版本 |
| `live` | interact | 推 4 条 `progress`，支持会话内 request 回显，end 后返回 `done` |
| `make-resource` | invoke | 文本写成资源，返回 `ResourceRef` |
| `read-resource` | invoke | 读取 `ResourceRef` 文本 |

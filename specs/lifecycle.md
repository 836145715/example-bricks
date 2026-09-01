---
status: active
type: contract-guide
related_code:
  - specs/manifest.schema.json
related_docs:
  - ai-bricks/specs/lifecycle.md
  - ai-bricks/docs/superpowers/specs/2026-08-31-command-window-lifetime.md
last_verified: 2026-09-01
---

# Brick Lifecycle

实现唯一语义源是旁边 `ai-bricks` 仓库的 `specs/lifecycle.md`。本目录副本给 example-bricks 作者对照；字段以本目录 `manifest.schema.json` 为准。

作者只写 `runtime.instance`，不写顶层 `lifecycle`。开窗只写 `command.window`：`none` / `attach` / `standalone`。不要写 `runtime.window`、砖级 `windows`、`start({ allowStandaloneWindows })`。

## 作者模型（instance 四值）

| 作者 instance | 内核键 | 监督器 | 说明 |
| --- | --- | --- | --- |
| 省略 / `shared` | `shared` | 否 | 命令工具默认；空闲可回收 |
| `owned` | `owned` | 否 | 跟某次 `start()` / 体验窗 |
| `per-call` | `per-call` | 否 | 每次调用独立进程，不允许 `start()`，也不能声明 `attach` / `standalone` |
| `service` | `shared` | 是 | 宿主钉住的一份；别人仍按普通命令调用 |

`service` 只给关窗后仍要跑的后台（剪贴板历史、提醒）。带体验窗的调试、共享、测试台用 `owned`：窗口 `start()` 占用进程，关窗即停。开机预热只写 `runtime.autoStart`（仅 `instance=service`）。加载器缺省只补 `shared`。旧顶层 `lifecycle.service` 仍会被读成 `instance: service`，示例里不要再写。

后台定时弹窗：已有占用时 `brick.invoke('preview')`，弹窗命令标 `window: standalone`。不要在定时器里直接 `createWindow`。

```json
{
  "runtime": {
    "type": "node",
    "instance": "service",
    "autoStart": true,
    "entry": { "win-x64": "runtime/win-x64/index.js" }
  }
}
```

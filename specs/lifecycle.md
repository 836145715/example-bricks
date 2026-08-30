---
status: active
type: contract-guide
related_code:
  - specs/manifest.schema.json
related_docs:
  - ai-bricks/specs/lifecycle.md
last_verified: 2026-08-27
---

# Brick Lifecycle

实现唯一语义源是 ai-bricks 仓库的 `specs/lifecycle.md`。本目录副本给 example-bricks 作者对照；字段以 `manifest.schema.json` 为准。

作者只写 `runtime.instance`，不写顶层 `lifecycle`。

## 作者模型（instance 四值）

| 作者 instance | 内核键 | 监督器 | 说明 |
| --- | --- | --- | --- |
| 省略 / `shared` | `shared` | 否 | 命令工具默认；空闲可回收 |
| `owned` | `owned` | 否 | 跟某次 `start()` / 体验窗 |
| `per-call` | `per-call` | 否 | 每次调用独立进程，不允许 `start()` |
| `service` | `shared` | 是 | 宿主钉住的一份；别人仍按普通命令调用 |

开机预热只写 `runtime.autoStart`（仅 `instance=service`）。加载器缺省只补 `shared`，不会按旧 `lifecycle.state` 猜 `owned`。旧顶层 `lifecycle.service` 读成 `instance: service`。

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

窗口应用显式写 `instance: owned`，并保留 `ui.webview`。`per-call` 不能 `start()`，因此不能开 standalone 窗。

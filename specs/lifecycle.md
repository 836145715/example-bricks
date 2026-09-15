---
status: redirected
type: contract-guide
related_code:
  - specs/manifest.schema.json
related_docs:
  - ai-bricks/specs/runtime.md
last_verified: 2026-09-04
---

# Brick Lifecycle

作者不写 `lifecycle`，也不写 `command.window` / `runtime.window`。开窗由代码里的 `ctx.ui`（Call 绑定）与 `brick.ui`（Session 绑定）驱动，Session 窗加 `keepAlive` 才能在调用归还后留下。现行契约见旁边 `ai-bricks` 仓库的 `specs/runtime.md`；manifest 字段以本目录 `manifest.schema.json` 为准。

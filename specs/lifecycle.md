---
status: active
type: contract-guide
related_code:
  - specs/manifest.schema.json
  - Brickly/src/shared/bridge-types.ts
  - Brickly/src/main/runtime/brick-lifecycle.ts
  - Brickly/src/main/runtime/process-key.ts
  - Brickly/src/main/runtime/command-execution.ts
  - Brickly/src/main/runtime/brick-runtime-manager.ts
  - Brickly/src/main/runtime/brick-service-supervisor.ts
  - Brickly/src/main/runtime/lifecycle
related_docs:
  - docs/superpowers/specs/2026-07-22-runtime-lifecycle-simplification-constitution.md
last_verified: 2026-07-23
---

# Brick Lifecycle

实现唯一语义源（ai-bricks 仓库）：  
`docs/superpowers/specs/2026-07-22-runtime-lifecycle-simplification-constitution.md`

本目录副本供 example-bricks 作者对照；字段以 `manifest.schema.json` 为准。

本文是 **作者与宿主契约摘要**；细节与不变量以宪章为准。

## 作者模型（两态）

```json
{
  "lifecycle": {
    "state": "stateless",
    "idleTimeoutMs": 600000
  }
}
```

```json
{
  "lifecycle": {
    "state": "stateful"
  }
}
```

```json
{
  "lifecycle": {
    "state": "stateful",
    "service": {
      "autoStart": true,
      "restart": "on-failure",
      "maxAttempts": 5,
      "backoffMs": 2000,
      "healthyAfterMs": 300000
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `state` | `stateless`（默认）/ `stateful` |
| `idleTimeoutMs` | 仅 stateless；空闲回收；`0` = 无占用后立即关 |
| `service` | 仅 stateful；宿主持有的全局后台服务 |

**已删除：** `mode` / `scope` / `concurrency` / `idleTtlMs` / `maxLifetimeMs` / `maxRestarts`（顶层）/ `restart: always`。

命令并发在 **command.execution**（`queue` 默认 / `parallel` / `reject` / `replace`），不属于 lifecycle。

## Profile

- **不需要** Profile 的工具（无 `config.fields`）：调用可不传 `profileId`。
- **需要** Profile：必须能解析到 id，否则 `INVALID_INPUT`（文案含 `PROFILE_REQUIRED`，UI 应提示选择）。
- **禁止** 对需要 Profile 的工具静默伪造 default。
- 进程 **打开时** 快照配置；之后改存储 **不管** 已开进程。

## 进程复用键（实现名 ProcessKey）

| 种类 | 键 | 行为 |
| --- | --- | --- |
| 无状态池 | `(brickId)` 或 `(brickId, profileId)` | 空闲按 idleTimeoutMs 回收 |
| 有状态会话 | `(brickId, usageSessionId[, profileId])` | usage 结束则关 |
| 服务 | `(brickId)` | 仅 Supervisor 启停；管理 UI 关窗不停服 |

服务预热 **只** 看生效 `service.autoStart`，**不** 读 `triggers: host-start`。

## 验证

```bash
cd Brickly
npx tsx --test src/main/runtime/__tests__/brick-lifecycle-resolve.test.ts
npm run typecheck:node
```

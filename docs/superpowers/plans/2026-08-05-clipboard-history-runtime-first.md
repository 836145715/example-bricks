# 剪贴板历史 Runtime-first 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将剪贴板历史的业务调用迁移到 `window.brickly.invoke()` 和 Runtime clipboard API，并用现有 EventBus 向自有 UI 与其他 Brick 发布可回收的公开变化通知。

**架构：** Runtime 入口只负责 SDK 命令与事件接线，可注入的 `history-service.cjs` 负责历史状态、去重、持久化和 revision。页面通过 `src/brickly.ts` 调用短命令；自定义 preload 只把经过事件名与来源校验的 `clipboard-history:changed` envelope 暴露为窄订阅接口。

**技术栈：** Node.js CommonJS、`node:test`、Electron preload、Brickly Node SDK、React 19、TypeScript 5、Vite 7。

---

## 文件结构

- 创建 `com.brickly.clipboard-history/runtime/node/history-service.cjs`：历史状态、入库、去重、持久化、revision 与运行指标。
- 创建 `com.brickly.clipboard-history/runtime/node/history-service.test.cjs`：领域逻辑单元测试。
- 修改 `com.brickly.clipboard-history/runtime/node/index.cjs`：SDK 命令、clipboard API 与 EventBus 接线。
- 创建 `com.brickly.clipboard-history/runtime/node/index.test.cjs`：Runtime 命令与事件集成测试。
- 修改 `com.brickly.clipboard-history/manifest.json`：增加 `os.clipboard` 和三个短命令。
- 修改 `com.brickly.clipboard-history/preload.cjs`：缩减为来源校验、引用计数和自动退订的事件桥。
- 修改 `com.brickly.clipboard-history/preload.test.cjs`：替换临时 domain 回归测试，覆盖最小事件桥。
- 创建 `com.brickly.clipboard-history/src/brickly.ts`：页面唯一的宿主适配层。
- 创建 `com.brickly.clipboard-history/ui-adapter.test.cjs`：通过 TypeScript 转译测试适配层调用契约，并检查旧门面已移除。
- 修改 `com.brickly.clipboard-history/src/types.ts`：定义 `window.brickly`、公开事件和 Runtime DTO。
- 修改 `com.brickly.clipboard-history/src/App.tsx`：改用适配层、事件合并刷新和 focus/visibility 兜底。
- 修改 `com.brickly.clipboard-history/package.json`：运行全部 Node 测试并增加显式类型检查脚本。
- 更新 `com.brickly.clipboard-history/ui/index.html` 与 `ui/assets/*`：提交 Vite 构建产物。

### 任务 1：将 preload 缩减为事件桥

**文件：**
- 修改：`com.brickly.clipboard-history/preload.test.cjs`
- 修改：`com.brickly.clipboard-history/preload.cjs`
- 修改：`com.brickly.clipboard-history/package.json`

- [ ] **步骤 1：用失败测试定义 preload 契约**

测试加载 preload、捕获暴露 API，并断言订阅不传 Brick ID/domain、过滤错误来源、最后一个 listener 取消时退订：

```js
test('只转发 Clipboard History 自身发布的变化事件', async () => {
  const harness = loadPreload()
  const received = []
  const dispose = await harness.api.subscribe((envelope) => received.push(envelope))

  harness.notify({ event: HISTORY_EVENT, sourceBrickId: 'other.brick', payload: {} })
  harness.notify({ event: HISTORY_EVENT, sourceBrickId: BRICK_ID, payload: { revision: 1 } })

  assert.equal(received.length, 1)
  assert.deepEqual(harness.calls[0], ['platform.event.subscribe', { event: HISTORY_EVENT }])
  await dispose()
  assert.deepEqual(harness.calls.at(-1), ['platform.event.unsubscribe', { event: HISTORY_EVENT }])
})
```

- [ ] **步骤 2：运行测试确认旧 preload 失败**

运行：`node --test --test-name-pattern="只转发" preload.test.cjs`

预期：FAIL，旧 API 没有异步 `subscribe`，且订阅 payload 仍携带 `brickId`。

- [ ] **步骤 3：实现引用计数事件桥**

`preload.cjs` 仅保留以下状态和窄 API：

```js
const HISTORY_EVENT = 'clipboard-history:changed'
const SOURCE_BRICK_ID = 'com.brickly.clipboard-history'
const listeners = new Set()

ipcRenderer.on('platform.event.notify', (_event, envelope) => {
  if (envelope?.event !== HISTORY_EVENT || envelope?.sourceBrickId !== SOURCE_BRICK_ID) return
  for (const listener of [...listeners]) listener(envelope)
})

async function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener 必须是函数')
  listeners.add(listener)
  try {
    await ensureHostSubscription()
  } catch (error) {
    listeners.delete(listener)
    throw error
  }
  let active = true
  return async () => {
    if (!active) return
    active = false
    listeners.delete(listener)
    if (listeners.size === 0) await unsubscribeHost()
  }
}

contextBridge.exposeInMainWorld('clipboardHistoryEvents', { subscribe })
```

`ensureHostSubscription()` 使用原有 8 次有限退避，但只调用 `platform.event.subscribe`；不得解析 `process.argv`，不得调用 `bridge.invoke`、clipboard 或文件图标 IPC。

- [ ] **步骤 4：运行 preload 测试**

运行：`node --test preload.test.cjs`

预期：全部 PASS，包含多 listener、幂等取消、有限重试和来源过滤。

- [ ] **步骤 5：提交 preload 迁移**

```bash
git add com.brickly.clipboard-history/preload.cjs com.brickly.clipboard-history/preload.test.cjs com.brickly.clipboard-history/package.json
git commit -m "refactor(clipboard-history): 缩减 preload 为事件桥"
```

### 任务 2：实现 Runtime 领域服务与公开事件

**文件：**
- 创建：`com.brickly.clipboard-history/runtime/node/history-service.cjs`
- 创建：`com.brickly.clipboard-history/runtime/node/history-service.test.cjs`
- 修改：`com.brickly.clipboard-history/runtime/node/index.cjs`
- 创建：`com.brickly.clipboard-history/runtime/node/index.test.cjs`
- 修改：`com.brickly.clipboard-history/manifest.json`

- [ ] **步骤 1：编写失败的领域测试**

覆盖统一入库、无变化不增 revision、删除/清空/收藏 mutation reason，以及状态字段：

```js
test('事件与 sync 快照共用 ingest，并只为真实变化增加 revision', () => {
  const service = createHarness().service
  const first = service.ingest(
    { kind: 'text', text: 'hello', capturedAt: 100 },
    { event: 'clipboard:new-content', sourceBrickId: 'system', publishedAt: 100 }
  )
  const duplicate = service.ingest(
    { kind: 'text', text: 'hello', capturedAt: 101 },
    { event: 'clipboard:sync-now', sourceBrickId: 'system', publishedAt: 101 }
  )

  assert.equal(first.changed, true)
  assert.equal(first.reason, 'insert')
  assert.equal(duplicate.changed, false)
  assert.equal(service.status().revision, 1)
})
```

- [ ] **步骤 2：运行领域测试确认失败**

运行：`node --test runtime/node/history-service.test.cjs`

预期：FAIL，`history-service.cjs` 尚不存在。

- [ ] **步骤 3：提取最小领域服务**

导出稳定工厂，入口通过依赖注入传入目录和日志：

```js
function createHistoryService({ dataDir, mediaDir, dbPath, log, now = Date.now }) {
  let state = loadState()
  let revision = 0
  let dedupeHits = 0

  return {
    list,
    ingest,
    remove,
    clear,
    toggleFavorite,
    storageInfo,
    status
  }
}

module.exports = { createHistoryService }
```

每个 mutation 返回 `{ changed, reason, revision, count, item? }`；只有成功落盘后的真实变化增加 revision。`status()` 返回 `state: 'running'`、`startedAt`、`uptimeMs`、`count`、`maxItems`、`dedupeHits`、`processedEvents`、`lastEventAt`、`lastEventKind`、`lastError` 和 `revision`。

- [ ] **步骤 4：运行领域测试确认通过**

运行：`node --test runtime/node/history-service.test.cjs`

预期：PASS。

- [ ] **步骤 5：编写失败的 Runtime 接线测试**

用假的 `BricklyRuntime` 捕获 command handlers，验证三个新命令和公开 payload：

```js
test('sync-now 读取 runtime clipboard 并发布公开变化事件', async () => {
  const runtime = loadRuntime()
  const result = await runtime.commands.get('sync-now')(
    { platform: { clipboard: { readContent: async () => ({ kind: 'text', text: 'hello', capturedAt: 10 }) } } },
    {}
  )

  assert.equal(result.changed, true)
  assert.deepEqual(runtime.published[0], {
    event: 'clipboard-history:changed',
    payload: { revision: 1, count: 1, reason: 'sync', at: 10 }
  })
})
```

另测 `set-content` 仅调用 `ctx.platform.clipboard.setContent(input.content)`，`runtime-status` 返回 Runtime 自身状态，payload 不包含历史正文。

- [ ] **步骤 6：运行 Runtime 接线测试确认失败**

运行：`node --test runtime/node/index.test.cjs`

预期：FAIL，三个命令尚未注册，现有事件没有 revision/reason。

- [ ] **步骤 7：重写 Runtime 入口接线并更新 manifest**

入口通过统一函数发布状态变化：

```js
async function publishMutation(mutation, reason = mutation.reason) {
  if (!mutation.changed) return
  try {
    await brick.events.publish(HISTORY_EVENT, {
      revision: mutation.revision,
      count: mutation.count,
      reason,
      at: Date.now()
    })
  } catch (error) {
    log(`publish ${HISTORY_EVENT} failed: ${errorMessage(error)}`)
  }
}
```

`sync-now` 调用 `ctx.platform.clipboard.readContent()` 后将 snapshot 及其 `resource` 交给同一个 `service.ingest()`；`set-content` 校验 `{ content }` 后调用 Runtime clipboard API；`runtime-status` 返回 `service.status()`。manifest 增加 `os.clipboard` 和对应 `queue` commands，不增加 `watch`。

- [ ] **步骤 8：运行 Runtime 与 manifest 测试**

运行：`node --test runtime/node/history-service.test.cjs runtime/node/index.test.cjs`

预期：全部 PASS。

- [ ] **步骤 9：提交 Runtime 迁移**

```bash
git add com.brickly.clipboard-history/runtime/node/history-service.cjs com.brickly.clipboard-history/runtime/node/history-service.test.cjs com.brickly.clipboard-history/runtime/node/index.cjs com.brickly.clipboard-history/runtime/node/index.test.cjs com.brickly.clipboard-history/manifest.json
git commit -m "feat(clipboard-history): 收敛剪贴板业务到 runtime"
```

### 任务 3：建立 UI 宿主适配层

**文件：**
- 创建：`com.brickly.clipboard-history/src/brickly.ts`
- 修改：`com.brickly.clipboard-history/src/types.ts`
- 创建：`com.brickly.clipboard-history/ui-adapter.test.cjs`

- [ ] **步骤 1：编写失败的 UI 适配器测试**

测试使用 TypeScript `transpileModule` 在内存中加载 `src/brickly.ts`，为 `global.window` 注入假的宿主 API：

```js
test('UI CRUD、同步和写回全部调用当前 Brick runtime', async () => {
  const calls = []
  const api = loadAdapter({
    brickly: {
      invoke: async (command, input) => {
        calls.push([command, input])
        return command === 'list' ? { items: [] } : { ok: true }
      },
      system: { getFileIcon: async (path) => `icon:${path}` }
    }
  })

  await api.listHistory()
  await api.syncClipboardNow()
  await api.setClipboardContent({ kind: 'text', text: 'hello' })
  assert.deepEqual(calls, [
    ['list', { limit: 500 }],
    ['sync-now', {}],
    ['set-content', { content: { kind: 'text', text: 'hello' } }]
  ])
})
```

- [ ] **步骤 2：运行适配器测试确认失败**

运行：`node --test ui-adapter.test.cjs`

预期：FAIL，`src/brickly.ts` 尚不存在。

- [ ] **步骤 3：实现带类型的窄适配层**

导出 `listHistory`、`removeHistoryItem`、`clearHistory`、`toggleHistoryFavorite`、`getStorageInfo`、`syncClipboardNow`、`setClipboardContent`、`getRuntimeStatus`、`getFileIcon` 和 `subscribeHistoryChanged`。所有 runtime 函数统一通过：

```ts
async function invoke<T>(commandId: string, input: Record<string, unknown>): Promise<T> {
  const fn = window.brickly?.invoke
  if (!fn) throw new Error('当前页面没有可用的 Clipboard History runtime。')
  return fn(commandId, input) as Promise<T>
}
```

`types.ts` 删除旧的 `ClipboardHistoryStore`、`ClipboardHistoryPlatform` 和 `AIBricks`，声明 `window.brickly` 与 `window.clipboardHistoryEvents` 的最小形状。

- [ ] **步骤 4：运行适配器测试与类型检查**

运行：`node --test ui-adapter.test.cjs`

运行：`npx tsc --noEmit -p tsconfig.json`

预期：全部 PASS。

- [ ] **步骤 5：提交 UI 适配层**

```bash
git add com.brickly.clipboard-history/src/brickly.ts com.brickly.clipboard-history/src/types.ts com.brickly.clipboard-history/ui-adapter.test.cjs
git commit -m "feat(clipboard-history): 添加 UI runtime 适配层"
```

### 任务 4：迁移 React UI 并生成产物

**文件：**
- 修改：`com.brickly.clipboard-history/src/App.tsx`
- 修改：`com.brickly.clipboard-history/ui-adapter.test.cjs`
- 修改：`com.brickly.clipboard-history/ui/index.html`
- 删除/创建：`com.brickly.clipboard-history/ui/assets/index-*.js`
- 删除/创建：`com.brickly.clipboard-history/ui/assets/index-*.css`

- [ ] **步骤 1：增加失败的旧门面清理测试**

```js
test('App 不再读取旧 preload 门面或主窗口 API', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8')
  assert.doesNotMatch(source, /clipboardHistoryStore|clipboardHistoryPlatform|window\.AIBricks/)
  assert.match(source, /from '\.\/brickly'/)
})
```

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test --test-name-pattern="App 不再" ui-adapter.test.cjs`

预期：FAIL，`App.tsx` 仍直接访问三个旧门面。

- [ ] **步骤 3：迁移初始化、操作与文件图标**

初始化顺序为：注册事件 listener 并等待宿主订阅成功，然后并行读取列表、存储和 Runtime 状态。订阅最终失败时仍加载快照；事件以 `revision:at` 作为重复键并用单个 100ms timer 合并刷新。focus/visibility 同时刷新列表、存储和 Runtime 状态。

CRUD、同步、复制和文件图标全部改用 `src/brickly.ts`。状态面板从“宿主监听”改为 Runtime 自身状态，不再展示主窗口 clipboard helper 配置。

- [ ] **步骤 4：运行全部 Brick 测试和类型检查**

运行：`npm test`

运行：`npm run typecheck`

预期：全部 PASS，TypeScript 无错误。

- [ ] **步骤 5：构建并检查生成产物**

运行：`npm run build`

运行：`rg -n "clipboardHistoryStore|clipboardHistoryPlatform|window\.AIBricks|bridge\.invoke|platform\.clipboard" src preload.cjs ui`

预期：构建成功；搜索不命中旧门面、preload runtime 调用和 UI clipboard IPC。

- [ ] **步骤 6：提交 UI 迁移和构建产物**

```bash
git add com.brickly.clipboard-history/src/App.tsx com.brickly.clipboard-history/ui-adapter.test.cjs com.brickly.clipboard-history/ui
git commit -m "refactor(clipboard-history): 迁移 UI 到 runtime API"
```

### 任务 5：跨仓库回归验证与最终复核

**文件：**
- 验证：`com.brickly.clipboard-history/**`
- 验证：`D:/brick-project/ai-bricks/Brickly/src/main/events/__tests__/event-bus.test.ts`
- 验证：`D:/brick-project/ai-bricks/Brickly/src/main/bridge/__tests__/event-ipc.test.ts`
- 验证：`D:/brick-project/ai-bricks/Brickly/src/main/window/__tests__/managed-brick-ui-window-controller.test.ts`

- [ ] **步骤 1：运行 Clipboard History 完整验证**

运行：`npm test`

运行：`npm run typecheck`

运行：`npm run build`

预期：测试、类型检查和 Vite 构建全部通过。

- [ ] **步骤 2：运行宿主事件与窗口生命周期回归测试**

在 `D:/brick-project/ai-bricks/Brickly` 运行：

```bash
npx tsx --test src/main/events/__tests__/event-bus.test.ts src/main/bridge/__tests__/event-ipc.test.ts src/main/window/__tests__/managed-brick-ui-window-controller.test.ts
```

预期：全部 PASS，验证动态订阅、来源 envelope 和窗口销毁清理仍成立。

- [ ] **步骤 3：验证 manifest 与敏感路径**

运行：

```bash
rg -n "watch|bridge\.invoke|bricks\.invokeInstance|platform\.clipboard\.(status|captureNow|setContent)|clipboardHistoryStore|clipboardHistoryPlatform|window\.AIBricks" com.brickly.clipboard-history
```

预期：实现代码不命中；只允许规格/计划中的历史说明和测试中的负向断言命中。

- [ ] **步骤 4：检查最终 diff 和工作区归属**

运行：`git diff --check && git status --short && git log -6 --oneline`

预期：无空白错误；所有任务变更已提交；没有覆盖任务开始前用户已有的无关修改。

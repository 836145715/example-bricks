# 剪贴板历史 Runtime-first UI 通信设计

## 目标

将 `com.brickly.clipboard-history` 调整为以 runtime 为唯一业务边界的 Brick：

- 剪贴板读取、写入、立即同步、事件消费、去重和持久化全部在 runtime 内完成。
- UI 通过宿主注入的 `window.brickly.invoke()` 调用 runtime，通过 `window.brickly.system.*` 使用通用 UI 能力。
- runtime 通过现有 EventBus 发布公开的 `clipboard-history:changed` 事件，自有 UI 和其他 Brick 都可以订阅。
- 保留一个最小化的 Brick preload，只负责把该公开事件安全地转成自有 UI 的变更通知。
- 不向公共 `window.brickly` 增加 clipboard 或 events API。
- 保持现有历史数据目录、媒体目录和 `history.json` 格式不变。

## 现状与问题

宿主 `preload/brick.js` 已经为 runtime UI 注入 `window.brickly`，并负责解析当前 Brick ID、installed/development 运行域、runtime 实例和 surface binding。

剪贴板历史当前又通过自定义 `preload.cjs` 暴露：

- `window.clipboardHistoryStore`：调用 `list`、`remove`、`clear`、`toggle-favorite` 和 `storage-info`。
- `window.clipboardHistoryPlatform`：调用宿主剪贴板状态、立即抓取、写入和文件图标 IPC。
- `platform.event.subscribe` / `platform.event.notify`：监听 runtime 发布的历史变化事件并重新执行 `list`。

这形成了两套 runtime 自调用路径。自定义 preload 需要理解 Brick ID、runtime instance、运行域和 IPC 位置参数；生命周期调整为打开 UI 不预启动 runtime 后，这套重复封装遗漏 development 域，导致开发工作台打开时报 `BRICK_NOT_FOUND`。

现有 EventBus 已经具备所需事件链路：runtime 可以发布事件，Brick UI 可以动态订阅，其他 Brick runtime 可以通过 manifest 的 `subscriptions` 订阅，并使用 `from` 限定发布来源。UI 窗口销毁时，宿主会自动回收其动态订阅。

## 选定方案

采用短命令加 EventBus 通知：

```text
系统剪贴板
  -> 宿主发布 clipboard:new-content
  -> Clipboard History runtime 消费、去重、持久化
  -> runtime 发布 clipboard-history:changed
       -> 自有 UI 的最小 preload 接收通知 -> UI invoke('list')
       -> 其他 Brick 按 manifest subscription 接收

UI 操作
  -> window.brickly.invoke
  -> Clipboard History runtime
  -> ctx.platform.clipboard / 本地历史存储
```

选择该方案的原因：

- runtime 已拥有 manifest 事件订阅、事件发布和 `ctx.platform.clipboard` 权限边界。
- `window.brickly.invoke()` 已正确封装 UI 到当前 runtime 的调用身份，无需自定义 preload 处理 Brick ID、domain、instance ID 或原始 runtime IPC。
- EventBus 是现有的跨 Brick 事件机制，既能通知自有 UI，也不会阻止其他 Brick 订阅公开事件。
- UI 订阅只保留 EventBus 映射，不创建长驻 command、lease 或 Trace；显式退订和窗口销毁都能回收。
- 不使用长驻 `watch` command，避免调用者忘记取消后长期占用 invocation 和 runtime 生命周期资源。

## Runtime 命令契约

保留现有命令：

| 命令 | 语义 |
| --- | --- |
| `list` | 返回历史列表，支持 `limit`。 |
| `remove` | 删除指定历史项。 |
| `clear` | 清空历史，可保留收藏。 |
| `toggle-favorite` | 切换收藏状态。 |
| `storage-info` | 返回数据目录、媒体目录、数据库路径和条目数。 |

新增命令：

| 命令 | execution | 语义 |
| --- | --- | --- |
| `sync-now` | `queue` | 通过 `ctx.platform.clipboard.readContent()` 读取当前剪贴板，并复用统一入库流程。 |
| `set-content` | `queue` | 通过 `ctx.platform.clipboard.setContent()` 写回文本、图片或文件。 |
| `runtime-status` | `queue` | 返回 runtime 自身监听和存储状态，不暴露宿主全局剪贴板管理状态。 |

所有命令都是有限时长调用。设计中不新增 `watch` 或其他等待事件才结束的命令。

## 公开事件契约

`clipboard-history:changed` 是公开、低敏感度的状态变化事件。自有 UI 可以订阅它，其他 Brick 也可以通过现有 EventBus 能力订阅它。

这里的“公开”是发布者承诺的事件契约，不引入新的 EventBus manifest 元数据或 ACL。

事件 envelope 的发布来源必须是 `com.brickly.clipboard-history`。稳定 payload 为：

```json
{
  "revision": 12,
  "count": 86,
  "reason": "insert",
  "at": 1785900000000
}
```

- `revision` 是 runtime 进程内单调递增值，runtime 重启后可以重新从零开始，不能作为持久化版本号。
- `count` 是变化后的历史条目数。
- `reason` 仅允许 `insert`、`remove`、`clear`、`favorite` 和 `sync`。
- `at` 是事件发布时间戳。
- payload 不包含剪贴板正文、图片内容、文件路径或完整历史列表。

订阅者必须同时匹配事件名和发布来源。其他 Brick runtime 应在 manifest 中声明：

```json
{
  "event": "clipboard-history:changed",
  "from": "com.brickly.clipboard-history"
}
```

`from` 和 UI 对 `envelope.sourceBrickId` 的校验用于确认发布者身份，不限制哪些 Brick 可以订阅该公开事件。

事件只表示“状态可能发生变化”，不承诺为订阅者保存或重放。自有 UI 收到事件后调用 `list` 获取权威状态；窗口 focus 或恢复可见时也主动执行一次 `list`，弥补页面挂起或尚未完成订阅时错过的通知。

## Runtime 内部边界

runtime 将现有入库逻辑收敛为一个统一入口，供宿主事件和 `sync-now` 共用：

```text
clipboard:new-content envelope -> resolve resource -> normalize -> ingest
sync-now readContent result ---------------------------> ingest
```

`ingest` 负责类型识别、内容 hash、时间窗口去重、图片持久化、列表裁剪和落盘。调用方不得各自复制这些规则。

每次真实状态变化时：

1. 增加进程内 `revision`。
2. 在状态落盘成功后发布一次 `clipboard-history:changed`。
3. 发布失败只记录错误，不回滚已经成功的本地状态变更。

`runtime-status` 只返回 runtime 能确认的事实，包括：

- runtime 启动时间和运行时长。
- 当前条目数、最大条目数和去重次数。
- 已处理事件数、最后一次事件时间、类型和错误。
- 当前 revision。

不继续展示 runtime 无法可信获得的宿主 helper 状态、全局 subscriber 设置或宿主剪贴板管理配置。

## Preload 与 UI 边界

保留 `preload.cjs`，但将职责缩减为事件桥：

- 订阅和退订 `clipboard-history:changed`。
- 只接收 `event === 'clipboard-history:changed'` 且 `sourceBrickId === 'com.brickly.clipboard-history'` 的 envelope。
- 通过 context-isolated 的窄接口向页面提供异步 `subscribe(listener)`；宿主订阅成功后返回取消监听函数。
- 最后一个页面监听者取消时主动退订；窗口销毁时由宿主自动清理作为兜底。
- 订阅失败可以有限退避重试，但不得创建 runtime command 或保持 runtime invocation。

preload 不再：

- 解析或传递当前 Brick ID、domain、instance ID、session ID 或 binding。
- 封装 `list`、CRUD、同步、写入等 runtime command。
- 调用 clipboard、文件图标或其他平台业务 IPC。
- 暴露 `window.clipboardHistoryStore` 或 `window.clipboardHistoryPlatform`。

preload 内固定的 `sourceBrickId` 只用于校验事件 envelope 的发布来源，不参与 runtime 路由或调用身份解析。

新增或整理 `src/brickly.ts` 作为 UI 唯一宿主适配层：

- 校验 `window.brickly` 和所需方法是否存在。
- 为所有 runtime 命令提供带类型的函数。
- 使用 `window.brickly.system.getFileIcon()` 获取文件图标。
- 接入 preload 提供的窄事件监听接口，并合并短时间内的重复刷新。
- 不包含 React state、筛选规则或展示文案。

`App.tsx` 不再读取 `window.clipboardHistoryStore`、`window.clipboardHistoryPlatform` 或 `window.AIBricks`。

UI 初始化时先注册 listener 并等待宿主订阅成功，再并行读取 `list`、`storage-info` 和 `runtime-status`，避免初始快照与订阅建立之间出现通知空档。若订阅在有限重试后仍失败，UI 仍读取初始数据并降级到 focus/visibility 刷新。复制、收藏、删除、清空和立即同步均等待 runtime 命令完成后再更新本地状态。UI 卸载时调用事件监听的取消函数，不停止 stateful service。

## 权限与安全

manifest 增加 `os.clipboard`，用于 runtime 的 `readContent()` 和 `setContent()`。保留：

- `resource.get`：解析宿主剪贴板事件携带的资源。
- `event.publish:clipboard-history:changed`：发布公开的历史变化事件。

manifest 的 `clipboard:new-content` subscription 保持不变。其他 Brick 是否订阅 `clipboard-history:changed` 由各自 manifest 决定，不需要 Clipboard History 为订阅者建立长连接。

UI 不获得 clipboard/events 公共 API，也不直接调用 runtime、clipboard 或文件图标的原始 `platform.*` IPC。事件 preload 只暴露特定事件的接收接口，不暴露通用发布能力。

## 错误处理

| 失败位置 | 处理方式 |
| --- | --- |
| `window.brickly` 不可用 | UI 进入不可操作错误态，不回退到 `window.AIBricks` 或原始 IPC。 |
| 初次 `list` 失败 | 展示错误，并允许窗口 focus 或用户现有刷新动作重试。 |
| UI 事件订阅失败 | 有限退避重试；命令操作仍可用，focus/visibility 刷新作为一致性兜底。 |
| 事件发布失败 | 保留已经落盘的状态并记录错误，不让一次通知失败破坏 CRUD 或同步结果。 |
| `sync-now` 读取失败 | 保留当前列表并展示 runtime 返回的错误。 |
| `set-content` 失败 | 不伪造成功状态，展示写入失败。 |
| 页面监听取消 | 最后一个监听者取消时退订宿主事件；重复取消保持幂等。 |
| UI 窗口销毁 | 宿主按 `webContents` 自动删除残留订阅。 |
| runtime shutdown | 清理定时器和宿主事件监听器，不存在 watcher 清理。 |

事件订阅重试使用有限次数和封顶延迟，同一时刻最多存在一个重试任务。页面卸载或订阅成功后停止重试。

## 兼容与迁移

- 历史数据路径继续使用 `~/.brickly/apps/com.brickly.clipboard-history`。
- `history.json` 和媒体文件命名保持兼容，不执行数据迁移。
- 保留现有五个 CRUD/查询 command ID，外部调用者不受影响。
- 三个新增命令属于向后兼容的 manifest 扩展。
- `clipboard-history:changed` 保留现有 `count` 和 `at` 字段，并新增 `revision`、`reason`；旧订阅者可以忽略新增字段。
- `window.clipboardHistoryStore` 和 `window.clipboardHistoryPlatform` 是该 Brick 的内部 UI 门面，不作为公共 SDK；迁移后直接删除，不提供双轨兼容。
- 先前为自定义 preload runtime 调用添加的 development domain 修复将由 `window.brickly.invoke()` 路径取代；对应测试改为覆盖最小事件 preload，而不是直接丢弃回归保护。

## 测试与验收

至少覆盖：

1. manifest 保留最小 preload，并声明 `os.clipboard`、事件发布权限和三个新增命令，不声明 `watch`。
2. UI 的所有 runtime 操作都通过 `window.brickly.invoke()`，不读取旧全局对象。
3. development 窗口无需 UI 自行传 Brick ID、domain 或 instance ID 即可执行 `list`。
4. preload 只订阅事件，不调用 runtime command、clipboard 或文件图标原始 IPC。
5. preload 同时校验事件名和 `sourceBrickId`，忽略同名但来源不同的事件。
6. preload 的异步订阅、页面取消函数、最后监听者退订、重复取消和订阅重试行为正确。
7. UI 窗口销毁后，宿主自动删除动态订阅。
8. 其他 Brick 以 `from: com.brickly.clipboard-history` 订阅时能收到公开变化事件。
9. 公开事件包含 `revision`、`count`、`reason`、`at`，且不包含剪贴板正文或完整历史数据。
10. `sync-now` 与 `clipboard:new-content` 使用同一入库和去重逻辑。
11. `set-content` 只通过 runtime clipboard API 写入。
12. insert/remove/clear/favorite/sync 真实改变状态后增加 revision 并发布事件；无变化时不发布。
13. UI 对同 revision 不重复刷新，对短时间连续变化进行合并。
14. focus/visibility 恢复时重新读取列表。
15. 原有 history 数据可直接读取，图片路径与收藏状态不变。
16. runtime 单元测试、preload 单元测试、UI 类型检查、Vite 构建和相关宿主事件测试通过。

## 非目标

- 不向 `window.brickly` 新增 clipboard 或 events API。
- 不新增 `watch` 或其他长驻 runtime command。
- 不把主窗口的剪贴板设置、subscriber 管理或 `captureNow` 控制面开放给 Brick UI。
- 不新增事件回放、持久化消息队列或“至少一次”投递保证。
- 不为 EventBus 增加 public/private 元数据或新的订阅权限模型。
- 不修改宿主 IPC、BPP 协议或 Node SDK 公共接口。
- 不改变剪贴板历史的筛选、搜索、预览和视觉设计。
- 不改变全局剪贴板监听服务的启停策略。
- 不新增跨设备同步、云存储、历史加密或数据迁移。

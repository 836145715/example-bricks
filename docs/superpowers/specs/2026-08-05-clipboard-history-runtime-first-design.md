# 剪贴板历史 Runtime-first UI 通信设计

## 目标

将 `com.brickly.clipboard-history` 调整为以 runtime 为唯一业务边界的 Brick：

- 剪贴板读取、写入、立即同步、事件消费、去重和持久化全部在 runtime 内完成。
- UI 只使用宿主已经注入的 `window.brickly.invoke()`、`window.brickly.stream()` 和 `window.brickly.system.*`。
- 删除 Brick 自定义 `preload.cjs`，不再让 UI 或 Brick 自定义 preload 接触 Electron IPC channel。
- 不向公共 `window.brickly` 增加 clipboard 或 events API。
- 保持现有历史数据目录、媒体目录和 `history.json` 格式不变。

## 现状与问题

宿主 `preload/brick.js` 已经为 runtime UI 注入 `window.brickly`，并负责解析当前 Brick ID、installed/development 运行域、runtime 实例和 surface binding。

剪贴板历史当前又通过自定义 `preload.cjs` 暴露：

- `window.clipboardHistoryStore`：调用 `list`、`remove`、`clear`、`toggle-favorite` 和 `storage-info`。
- `window.clipboardHistoryPlatform`：调用宿主剪贴板状态、立即抓取、写入和文件图标 IPC。
- `platform.event.subscribe` / `platform.event.notify`：监听 runtime 发布的历史变化事件并重新执行 `list`。

这形成了两套自调用路径。自定义 preload 需要理解 Brick ID、runtime instance、运行域和 IPC 位置参数；生命周期调整为打开 UI 不预启动 runtime 后，这套重复封装遗漏 development 域，导致开发工作台打开时报 `BRICK_NOT_FOUND`。

## 选定方案

采用 runtime 命令加长连接流式命令：

```text
系统剪贴板
  -> 宿主发布 clipboard:new-content
  -> Clipboard History runtime 消费、去重、持久化
  -> runtime 通知 active watch command
  -> UI 收到轻量 revision 后 invoke('list')

UI 操作
  -> window.brickly.invoke / stream
  -> Clipboard History runtime
  -> ctx.platform.clipboard / 本地历史存储
```

选择该方案的原因：

- runtime 已拥有 manifest 事件订阅和 `ctx.platform.clipboard` 权限边界。
- `window.brickly` 已正确封装 UI 到当前 runtime 的调用身份，无需新增宿主 API。
- 流式命令可以实时通知 UI，不需要定时轮询，也不需要 UI 订阅宿主事件。
- 删除自定义 preload 后，Brick UI 不再接触 Node、Electron 或底层 IPC。

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
| `watch` | `parallel` | 保持调用直到取消；历史变化时发送轻量 change chunk。 |
| `sync-now` | `queue` | 通过 `ctx.platform.clipboard.readContent()` 读取当前剪贴板，并复用统一入库流程。 |
| `set-content` | `queue` | 通过 `ctx.platform.clipboard.setContent()` 写回文本、图片或文件。 |
| `runtime-status` | `queue` | 返回 runtime 自身监听和存储状态，不暴露宿主全局剪贴板管理状态。 |

`watch` 的 change chunk 使用稳定的小对象：

```json
{
  "revision": 12,
  "count": 86,
  "reason": "insert"
}
```

`reason` 仅允许 `initial`、`insert`、`remove`、`clear`、`favorite` 和 `sync`。chunk 不携带完整历史列表，避免长文本或图片元数据被重复广播。UI 收到 revision 后合并同一轮刷新，并重新调用 `list`。

## Runtime 内部边界

runtime 将现有入库逻辑收敛为一个统一入口，供宿主事件和 `sync-now` 共用：

```text
clipboard:new-content envelope -> resolve resource -> normalize -> ingest
sync-now readContent result ---------------------------> ingest
```

`ingest` 负责类型识别、内容 hash、时间窗口去重、图片持久化、列表裁剪和落盘。调用方不得各自复制这些规则。

每次真实状态变化时：

1. 增加单调递增的进程内 `revision`。
2. 向所有 active `watch` 请求发送 change chunk。
3. 保留现有 `clipboard-history:changed` 发布，供其他 Brick 订阅。

`watch` 通过 `ctx.onCancel()` 注册清理；取消、窗口销毁、runtime shutdown 或宿主断连后必须移除 watcher。多个窗口或多个 watch 请求彼此隔离。

`runtime-status` 只返回 runtime 能确认的事实，包括：

- runtime 启动时间和运行时长。
- 当前条目数、最大条目数和去重次数。
- 已处理事件数、最后一次事件时间、类型和错误。
- 当前 revision 和 active watcher 数。

不继续展示 runtime 无法可信获得的宿主 helper 状态、全局 subscriber 设置或宿主剪贴板管理配置。

## 权限与安全

manifest 增加 `os.clipboard`，用于 runtime 的 `readContent()` 和 `setContent()`。保留：

- `resource.get`：解析宿主剪贴板事件携带的资源。
- `event.publish:clipboard-history:changed`：通知其他 Brick 历史已变化。

manifest 的 `clipboard:new-content` subscription 保持不变。UI 不获得 clipboard/events 公共 API，也不直接调用任何 `platform.*` IPC。

删除 manifest 顶层 `preload` 字段和 `preload.cjs` 后，页面只处于宿主标准 context-isolated UI 能力边界内。

## UI 边界

新增或整理 `src/brickly.ts` 作为 UI 唯一宿主适配层：

- 校验 `window.brickly` 和所需方法是否存在。
- 为所有 runtime 命令提供带类型的函数。
- 管理 `watch` 启动、取消和有限退避重连。
- 使用 `window.brickly.system.getFileIcon()` 获取文件图标。
- 不包含 React state、筛选规则或展示文案。

`App.tsx` 不再读取：

- `window.clipboardHistoryStore`
- `window.clipboardHistoryPlatform`
- `window.AIBricks`

UI 初始化流程：

1. 并行读取 `list`、`storage-info` 和 `runtime-status`。
2. 启动 `watch`。
3. 收到 change chunk 时按 revision 去重并合并刷新。
4. 窗口获得焦点或恢复可见时主动刷新一次，弥补挂起期间可能丢失的 UI 通知。

UI 卸载时取消 watch，不停止 stateful service。复制、收藏、删除、清空和立即同步均等待 runtime 命令完成后再更新本地状态。

## 错误处理

| 失败位置 | 处理方式 |
| --- | --- |
| `window.brickly` 不可用 | UI 进入不可操作错误态，不回退到 `window.AIBricks` 或原始 IPC。 |
| 初次 `list` 失败 | 展示错误并允许窗口 focus 或用户现有刷新动作重试。 |
| `watch` 异常结束 | 仅在页面仍存活时按有限退避重连；每次重连先执行 `list`。 |
| `sync-now` 读取失败 | 保留当前列表并展示 runtime 返回的错误。 |
| `set-content` 失败 | 不伪造成功状态，展示写入失败。 |
| 单个 watcher 发送失败 | 移除该 watcher，不影响其他 watcher、持久化或外部事件发布。 |
| runtime shutdown | 清理所有 watcher、定时器和事件监听器。 |

watch 重连退避固定为 250ms、500ms、1s、2s、5s；达到上限后保持 5s，不创建并行重连。页面卸载后不得继续重连。

## 兼容与迁移

- 历史数据路径继续使用 `~/.brickly/apps/com.brickly.clipboard-history`。
- `history.json` 和媒体文件命名保持兼容，不执行数据迁移。
- 保留现有五个 CRUD/查询 command ID，外部调用者不受影响。
- 新增命令属于向后兼容的 manifest 扩展。
- `window.clipboardHistoryStore` 和 `window.clipboardHistoryPlatform` 是该 Brick 的内部 UI 门面，不作为公共 SDK；迁移后直接删除，不提供双轨兼容。
- 先前为自定义 preload 添加的 development domain 修复与对应 preload 测试在迁移完成后删除，因为调用路径不再存在。

## 测试与验收

至少覆盖：

1. manifest 不再声明自定义 preload，并声明 `os.clipboard` 和新增命令。
2. UI 的所有 runtime 操作都通过 `window.brickly.invoke/stream`，不读取旧全局对象。
3. development 窗口无需 UI 自行传 domain 即可执行 `list`。
4. `sync-now` 与 `clipboard:new-content` 使用同一入库和去重逻辑。
5. `set-content` 只通过 runtime clipboard API 写入。
6. insert/remove/clear/favorite/sync 都增加 revision 并通知 watcher。
7. watch 初始 chunk、正常变化、取消和多 watcher 隔离正确。
8. watch chunk 不包含完整历史数据。
9. UI 对同 revision 不重复刷新，对短时间连续变化进行合并。
10. watch 断开后单飞退避重连，UI 卸载后停止重连。
11. focus/visibility 恢复时重新读取列表。
12. 原有 history 数据可直接读取，图片路径与收藏状态不变。
13. runtime 单元测试、UI 类型检查、Vite 构建和相关宿主窗口测试通过。

## 非目标

- 不向 `window.brickly` 新增 clipboard 或 events API。
- 不把主窗口的剪贴板设置、subscriber 管理或 `captureNow` 控制面开放给 Brick UI。
- 不修改宿主 IPC、BPP 协议或 Node SDK 公共接口。
- 不改变剪贴板历史的筛选、搜索、预览和视觉设计。
- 不改变全局剪贴板监听服务的启停策略。
- 不新增跨设备同步、云存储、历史加密或数据迁移。

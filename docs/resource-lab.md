# Resource Lab 使用与验收

Resource Lab 是资源 API 的交互式验收工具，由一个工作台 Brick 和 Node.js、Python、Go 三个 Echo Brick 组成。它只使用公开 SDK，不读取 Host 内部资源目录，也不会把 capability token、资源正文或 Base64 写入日志和导出报告。

## 组成

| Brick | 用途 |
| --- | --- |
| `com.brickly.resource-lab` | 场景编排、增量状态、取消、导出和重启检查点 |
| `com.brickly.resource-echo-node` | Node.js 读取、创建、变换和转交 |
| `com.brickly.resource-echo-python` | Python 读取、创建、变换和转交 |
| `com.brickly.resource-echo-go` | Go 读取、创建、变换和转交 |

在开发工作区中先发布三个 Echo Brick，再发布 Resource Lab。打开工作台时 UI 会显式调用 `service.start()`；仅打开 Brick 列表不会启动服务。关闭窗口不会停止正在运行的 stateful Runtime，停止指定测试批次请使用工具栏的停止按钮。

## 套件边界

默认全测覆盖 1 KiB、8 MiB 和 64 MiB，包含创建、Writer `writeFrom()`、任意大小写入块、流式读取、保存、Node/Python/Go 调用、多跳转交、事件、TTL 活动流、revoke、伪造 token、取消和不可变快照。64 MiB 场景会经过 Resource Lab、Node、Python、Go 完整链路。整个 Runtime 在所有窗口之间合计最多并发三个场景；独占场景会等待所有窗口的普通场景结束后单独运行。

Host 将资源 TTL 最小钳制为 60 秒，默认套件会按实际 `expiresAt` 等待，因此完整运行通常至少需要一分钟；等待期间仍可停止当前 runId。

压力测试必须在 UI 中手动确认，覆盖：

- 201 MiB 整体读取被拒绝；
- 201 MiB 流式读写；
- 1 GiB 流式读写；
- finish 后慢速下游读取不反压上游写入。

运行 1 GiB 场景前至少保留 2 GiB 可用磁盘空间。工具不会在默认测试或统一验收脚本中自动执行 201 MiB/1 GiB。

## 多窗口与结果

每个窗口使用独立前缀生成 `runId`。UI 通过可取消的 `stream('suite-run')` 立即获得控制句柄；Runtime 命令保持到批次终态，以便 Writer 和下游 child invocation 共享正确的调用生命周期。停止时先取消该窗口持有的流调用，再按 `runId` 收敛状态，不会取消其他窗口的批次。慢速 Node 读取还使用独立 `operationId/cancel-hold` 控制命令，确认 child 已收到取消且资源清理结束后才进入 `cancelled`。单项完成后通过 `resource-lab:run-updated` 资源事件立即显示，2 秒状态轮询只用于补偿断线或漏事件。

导出按钮通过 `suite-export` 获得 JSON `ResourceHandle`，读取后立即关闭句柄。导出内容只包含场景、状态、耗时、吞吐、哈希、公开资源元数据和脱敏错误。

`resource-lab:run-updated` 通过 EventBus 发布。UI 的 `window.brickly.events.subscribe()` 回调中，
`envelope.payload` 固定为 `ResourceHandle`；UI 调用 `json()` 取得完整 `RunSnapshot`，校验结构后
合并状态，并在读取完成后关闭句柄。内部 `{ resource, encoding }` 传输包装不会暴露给工具代码。

## 重启验收

1. 点击“准备重启验收”，UI 保存只包含 `runId/pid/nonce/preparedAt` 的检查点，不创建伪 orphan Writer。
2. 重启 Brickly，并重新打开 Resource Lab。
3. UI 自动调用 `restart-verify`，确认进程已更换且 Runtime 恢复。

公开 SDK 无权检查 Host 的真实资源存储目录。因此 UI 只通过旧 PID 与新 Runtime PID 验证进程确实重启；orphan `.part` 文件启动清理和 shutdown 关流顺序由 Host E2E 验证，不会在工具中伪装成通过。

## 自动化验收

在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-resource-lab.ps1
```

该命令运行四个 Brick 的单元测试、Node/Python 语法检查、Go 测试和六平台构建、UI 测试/类型检查/生产构建、四份 manifest schema 以及 Git 空白检查。

同时运行 Brickly Host 的真实 Node/Python/Go 多进程资源 E2E：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-resource-lab.ps1 -IncludeHostE2E
```

显式执行 Host 201 MiB E2E：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-resource-lab.ps1 -IncludeLargeHostE2E
```

`-IncludeHostE2E` 会在临时目录装载四个真实 Brick，并执行 Resource Lab 完整默认套件；临时 Python 环境使用同一 Host 仓库中的本地 SDK。`-IncludeLargeHostE2E` 还会运行 Host 的多进程资源夹具，覆盖 201 MiB、多跳 ResourceRef、TTL、revoke、取消上传、shutdown、启动 orphan 清理和进程重启。1 GiB 仍只从 Resource Lab UI 手动启动。

## 视觉验收

启动 UI 开发服务后运行：

```powershell
cd com.brickly.resource-lab
npm run dev -- --host 127.0.0.1 --port 4317
npm run test:visual
```

脚本使用脱敏模拟数据检查 1440x900、1024x768 和 390x844 三个视口，验证页面非空、结果已显示、无横向溢出和无控制台错误。真实命令、事件与资源链路仍以 Host E2E 和安装后的默认套件为准。

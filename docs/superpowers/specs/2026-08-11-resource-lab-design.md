# Resource Lab 资源测试工具设计

## 目标

创建一个可安装的交互式 Resource Lab Brick，使用公开 SDK 验证真实 Runtime 资源链路。工具同时支持一键默认验收、按场景运行、压力测试、增量结果展示和脱敏报告导出。

测试工具由一个带 UI 的 Node.js 编排器和三个无 UI 的 Echo Brick 组成：

```text
com.brickly.resource-lab
com.brickly.resource-echo-node
com.brickly.resource-echo-python
com.brickly.resource-echo-go
```

测试代码不得调用 Host 内部接口。测试通过应代表普通 Brick 作者通过公开 SDK 使用资源能力时链路正常。

## 套件分层

默认套件覆盖 `1 KiB`、`8 MiB` 和 `64 MiB` 资源，适合日常回归。压力套件由用户显式启动，额外覆盖 `201 MiB`、`1 GiB`、慢速读取、中途取消和重启验收。

测试结果包含状态、场景、目标语言、字节数、耗时、吞吐量、SHA-256、错误码和脱敏诊断。状态固定为：

- `passed`
- `failed`
- `skipped`
- `cancelled`
- `waiting-restart`

`skipped` 仅用于当前环境无法安全触发的可选条件，例如特定磁盘余量或配额配置，不得用于掩盖功能失败。

## 覆盖矩阵

### 创建与写入

- 空资源、UTF-8 文本、二进制和 Unicode 分段边界
- `resources.create()` 小内容快速路径
- `resources.createFrom()` 的 AsyncIterable 与流式来源
- `createWriter()` 多次 `write()`、任意调用块大小和内部 1 MiB wire 分块
- `writeFrom()`、`finish()`、`abort()`
- finish 后写入、abort 后写入、重复 finish 等错误状态
- MIME、name、size 和 SHA-256 元数据校验

### 读取与落盘

- `text()`、`json()`、`stream()`、`saveTo()`
- 流式读取字节数、分块数和 SHA-256 校验
- 提前停止读取并关闭流，随后重新读取
- 同一 ResourceHandle 并发读取被明确拒绝
- 完整资源保存到临时文件并校验内容
- 超过 200 MiB 时整体物化被拒绝，但流式读取成功

### 跨 Brick 与跨语言

- Resource Lab 分别调用 Node.js、Python 和 Go Echo Brick
- 下游读取并返回校验报告
- 下游创建新资源并通过 `invokeResource` 返回
- 原 ResourceHandle 不读取正文直接转交
- Node.js → Python → Go 多跳传递
- 多跳过程中资源字节不重复复制，最终内容和元数据保持一致
- 资源事件发送、三语言事件接收和 ResourceHandle 水合

### 生命周期与安全边界

- revoke 后新读取失败
- TTL 到期后新读取失败，活动读取不被中断
- capability token 伪造失败
- 未被 Host 调用链或事件链授权的 Brick 无法读取
- finish 后资源是不可变快照
- 调用取消、实例退出和 Runtime shutdown 会 abort 未完成 Writer
- 读取流在成功、失败和取消路径都被关闭
- 导出报告和日志不包含 token、资源正文、Base64 或宿主绝对资源路径

### 边界与压力

- 普通 `invoke` 保持直接值语义
- `invokeResource` 无论结果大小都返回 ResourceHandle
- 64 MiB 默认大载荷完整链路
- 201 MiB 整体物化拒绝与流式读写
- 201 MiB、1 GiB store-and-forward 吞吐测试
- 慢速下游读取不影响已经 finish 的上游 Writer
- 压力运行中途取消后没有继续增长的临时资源
- 多窗口使用独立 runId，取消一个批次不影响另一个窗口

## 组件设计

### Resource Lab Runtime

Runtime 负责用例注册、调度、取消、结果聚合、重启检查点和报告导出。公开命令为：

- `suite-list`
- `suite-run`
- `suite-cancel`
- `suite-status`
- `suite-export`
- `restart-prepare`
- `restart-verify`

默认最多并发运行三个互不干扰的场景。压力、TTL 和重启场景独占执行。每次运行生成独立 `runId`，取消操作只作用于该 runId。

Runtime 通过 `resource-lab:run-updated` 事件发布增量状态。事件 payload 使用 ResourceHandle。UI 收到事件后立即更新单项结果，并通过 `suite.status` 在初始化、断线或漏事件后恢复完整状态。

资源句柄在 `finally` 中关闭，不再使用的测试资源会 revoke。未完成 Writer 在失败、取消和 shutdown 时 abort。

### Echo Brick 契约

Node.js、Python 和 Go 实现一致的命令语义：

- `inspect`：流式读取资源并返回字节数、分块数和 SHA-256
- `relay`：将资源引用传给指定下游，不物化正文
- `transform`：读取输入并创建新的输出资源
- `produce`：创建指定大小、分块模式和内容种子的资源
- `hold`：按配置慢速读取，用于并发和取消测试
- `event-echo`：接收资源事件并保存可查询的校验结果

各实现返回统一 DTO，使 Resource Lab 可以用同一组断言比较三种语言。

## UI 设计

界面采用工作台布局：

- 顶部工具栏：运行默认套件、运行压力套件、停止、清空结果、导出 JSON
- 左侧用例树：创建写入、读取落盘、跨语言、生命周期、压力
- 中间结果表：状态、场景、目标语言、大小、耗时、吞吐量、错误码
- 右侧详情：参数、脱敏 ResourceRef、阶段耗时、hash 对比、错误与诊断
- 底部状态栏：运行数、成功数、失败数、跳过数、Host 能力与临时存储统计

单项完成后立即显示，不等待整套结束。失败项可以单独重跑，当前会话保留历史轮次。报告导出为脱敏 JSON 资源。

## 重启验收

重启测试采用两阶段流程：

1. `restart-prepare` 创建未完成上传和短期检查点，返回等待重启状态。
2. 用户重启 Brickly 并重新打开 Resource Lab。
3. UI 检测检查点并调用 `restart-verify`。
4. Runtime 验证旧引用失效、未完成上传不可继续，并清理检查点。

Resource Lab 不自行退出或重启 Host。

## 错误处理

每个场景定义预期成功值或预期错误码。非预期异常统一转为脱敏失败结果，并保留阶段信息。批次中的单项失败不会阻止其他独立场景完成；基础依赖失败时，依赖场景标记为 `skipped` 并明确记录依赖原因。

取消使用 AbortSignal 向当前场景传播。取消后的清理必须完成后，场景才进入 `cancelled` 状态。

## 自动化验证

- Runtime 单元测试覆盖用例调度、并发上限、独占场景、按 runId 取消、结果聚合和脱敏。
- 三个 Echo Brick 使用共享契约测试，验证命令 DTO 和 hash 算法一致。
- UI 测试覆盖增量结果、过滤、单项重跑、停止和重启检查点提示。
- 构建验证覆盖四个 Brick 的 manifest、Runtime 和 Resource Lab UI。
- 手工验收从 Resource Lab UI 运行默认套件；压力和重启套件由用户显式启动。

## 非目标

- 不暴露 ResourceBroker 内部记录或真实存储路径。
- 不修改 Host 配额来强行制造失败。
- 不把测试能力加入产品 Host UI。
- 不将 capability token 或资源正文写入测试报告。

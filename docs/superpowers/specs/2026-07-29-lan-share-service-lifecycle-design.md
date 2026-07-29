# 内网文件共享服务生命周期联动设计

## 目标

让 `com.brickly.lan-share` 的宿主 service 生命周期与内部 HTTP 文件服务保持一致：

- 用户点击“启动共享”时启动 Brick service 进程和 HTTP 文件服务。
- 关闭工具窗口不停止共享，后台进程继续运行。
- 用户点击“停止共享”时停止 HTTP 文件服务并关闭 Brick service 进程。
- Brickly 主程序重新启动后不自动恢复共享；用户必须再次点击启动。
- service 停止时，UI 不调用 runtime 命令，避免查询状态时隐式拉起进程。

## 现状与问题

manifest 已将该 Brick 声明为 `stateful service`，但 UI 仍通过 `window.brickly.invoke('start'/'stop')` 控制 runtime 内部的 `FileServer`。因此当前存在两层相互独立的运行状态：

1. 宿主管理的 Brick service 进程状态。
2. runtime 内部 HTTP 文件服务状态。

点击“停止共享”只停止第二层，Brick service 进程仍然常驻。UI 还会直接调用 runtime 的 `status`，无法在 service 真正停止时安全展示状态。

## 选定方案

由 UI 控制器同时编排宿主 service API 与现有 runtime 命令，不扩展宿主协议：

```text
启动：brickly.service.start()
  -> 等待宿主 service running
  -> invoke('start', config)
  -> HTTP server running

停止：invoke('stop')
  -> brickly.service.stop()
  -> Brick runtime process stopped

关窗：不执行 stop
```

选择该方案的原因：

- 复用已经实现并带身份鉴权的 `window.brickly.service.*` 控制面。
- 改动限制在内网文件共享 Brick，不修改宿主、BPP 或 Node/Python/Go runtime SDK。
- 保留现有 `ShareService`、HTTP server 与 runtime 命令边界，迁移风险较低。

## 生命周期状态模型

UI 以宿主 service 状态作为第一事实源，runtime 状态只在宿主 service 已运行时读取。

| UI 状态    | 数据来源                        | 允许操作                 |
| ---------- | ------------------------------- | ------------------------ |
| `loading`  | `brickly.service.getStatus()`   | 无                       |
| `stopped`  | 宿主状态 + UI 配置缓存          | 编辑配置、启动           |
| `starting` | 启动 operation                  | 等待                     |
| `running`  | 宿主状态 + runtime `status`     | 查看访问地址、日志、停止 |
| `stopping` | 停止 operation                  | 等待                     |
| `error`    | 最近失败 + 重新查询后的宿主状态 | 按真实状态重试           |

以下不变量必须成立：

- service 非 `running` 时不得调用 runtime `status`、`update-config`、`clear-log` 等命令。
- UI 卸载和窗口关闭不得调用 runtime `stop` 或 `brickly.service.stop()`。
- UI 显示“已停止”前，必须确认宿主 service 已停止。
- UI 显示“共享中”时，宿主 service 和 HTTP server 必须同时处于运行态。

## 启动流程

1. UI 校验共享目录、端口和上传配置。
2. 将非敏感配置写入 UI 本地缓存。
3. 调用 `window.brickly.service.start()`。
4. 宿主确认 service 为 `running` 后，调用 runtime `start(config)`。
5. runtime 启动 HTTP server 并返回完整 `ShareStatus`。
6. UI 进入 `running`，展示 URL、二维码和传输日志，并开始轮询 runtime `status`。

启动期间只能存在一个 operation；重复点击不创建第二次启动。

如果宿主 service 已经运行，跳过第 3 步，直接读取 runtime 状态；只有 HTTP server 未运行时才执行 runtime `start(config)`。

## 停止流程

1. UI 停止状态轮询并进入 `stopping`。
2. 调用 runtime `stop`，等待 HTTP server 停止监听并断开连接。
3. 无论第 2 步成功与否，都调用 `window.brickly.service.stop()`。
4. 重新读取宿主 service 状态。
5. 只有宿主状态为 `stopped` 时，UI 才进入 `stopped`。

runtime 的 `onShutdown` 继续调用 `ShareService.stop()`，作为 HTTP server 的最终清理路径。该清理必须保持幂等。

## 窗口与宿主退出

- 关闭内网文件共享窗口只销毁 UI，不改变 service 与 HTTP server 状态。
- 重新打开窗口时先读宿主 service 状态；若正在运行，再读取 runtime 状态并恢复轮询。
- manifest 保持 `service.autoStart: false`。
- manifest 将 `service.restart` 调整为 `none`，防止 runtime 崩溃或主程序重启后自动重新开放共享。
- Brickly 主程序退出时仍由宿主关闭 service；下次启动不恢复共享。

## 配置与敏感数据

service 停止后 runtime 不可查询，因此 UI 使用 `localStorage` 保存以下展示和启动所需数据：

- 共享目录。
- 端口。
- 是否允许上传。
- 是否已设置访问码。

访问码明文不得写入 `localStorage`。runtime 继续在自身数据目录中持久化访问码。UI 在“已设置访问码”且输入框留空时，不向 runtime 发送 `accessCode` 字段，以保留原值；输入新值时才覆盖。

UI 缓存不是服务运行状态的事实源。service 与 HTTP server 是否运行始终由宿主状态和 runtime `ShareStatus` 决定。

## 错误处理与补偿

| 失败位置                              | 处理方式                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `brickly.service.start()` 失败        | 保持 `stopped`，展示宿主错误                                              |
| service 已启动但 runtime `start` 失败 | 补偿调用 `brickly.service.stop()`，避免空转进程                           |
| runtime `stop` 失败                   | 记录错误，但继续调用 `brickly.service.stop()`                             |
| `brickly.service.stop()` 失败         | 重新读取宿主状态，不得提前显示已停止                                      |
| 运行中轮询失败                        | 先重查宿主状态；service 已停止则切换 stopped，否则保留 running 并提示错误 |

补偿停止失败时保留原始启动错误，并附加停止失败作为诊断信息，避免掩盖根因。

## 模块边界

- `src/brickly.ts`：封装 `window.brickly.service.*` 与 runtime invoke，不包含 React 状态。
- `src/hooks/useShareController.ts`：拥有 service/HTTP 联动状态机、单飞 operation、轮询和补偿。
- `src/types.ts`：补齐宿主 service 状态与 Brick UI service API 类型。
- `runtime/node/index.cjs`：保留 HTTP 命令处理与 `onShutdown` 最终清理。
- `runtime/node/services/share-service.cjs`：保持 HTTP server 启停幂等，并修正空访问码的保留语义。
- `manifest.json`：设置 `service.restart: none`，继续保持 `autoStart: false`。

## 测试与验收

至少覆盖以下场景：

1. 停止状态初始化只调用 `service.getStatus`，不调用 runtime `status`。
2. 启动严格按“宿主 service -> runtime HTTP server”顺序执行。
3. service 已运行时不会重复启动宿主进程。
4. runtime 启动失败会补偿停止宿主 service。
5. 停止严格按“runtime HTTP server -> 宿主 service”顺序执行。
6. runtime 停止失败时仍尝试停止宿主 service。
7. 宿主停止失败时 UI 不显示已停止。
8. React 组件卸载或窗口关闭不会触发停止。
9. 重新打开窗口可恢复运行状态、访问地址和日志轮询。
10. 空访问码输入不会清除 runtime 已保存的访问码。
11. runtime `onShutdown` 重复调用 HTTP stop 不产生异常。
12. runtime 测试、TypeScript 类型检查和 Vite 构建通过。

## 非目标

- 不扩展 `window.brickly.service.start()` 的参数。
- 不向 Node/Python/Go runtime SDK 添加服务启停 API。
- 不实现 Brickly 主程序启动后的自动共享恢复。
- 不实现 runtime 崩溃后的自动重启与 HTTP server 恢复。
- 不改变文件浏览、下载、上传、鉴权或传输日志协议。

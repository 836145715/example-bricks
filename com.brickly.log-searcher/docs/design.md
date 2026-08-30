---
status: active
type: design
related_code:
  - example-bricks/com.brickly.log-searcher/src/App.tsx
  - example-bricks/com.brickly.log-searcher/src/components/FileSelectDropdown.tsx
  - example-bricks/com.brickly.log-searcher/src/components/RemotePathBrowser.tsx
  - example-bricks/com.brickly.log-searcher/src/domain/paths.ts
  - example-bricks/com.brickly.log-searcher/runtime/browse.go
  - example-bricks/com.brickly.log-searcher/runtime/result_store.go
  - example-bricks/com.brickly.log-searcher/runtime/ssh.go
  - example-bricks/com.brickly.log-searcher/runtime/ssh_pool.go
last_verified: 2026-08-30
---

# 日志查询工具设计

`com.brickly.log-searcher` 是 SSH 远程日志检索示例砖。结果仓库放在 Go `owned` 进程里，UI 只 peek 当前视口。这篇说明当前结构、路径选择交互，以及后续应如何把状态收成 SearchJob。

## 1. 不该推翻的部分

这些已经是对的，后续重构要保住：

- Runtime 使用 `owned` Lifetime。结果存在该进程内存里，不能改成 `per-call`。
- UI 默认 `resultMode=store`。`search` 只推 `searchState`，行数据用 `peek_search_results` 按窗口读。
- 多文件检索复用同一条 SSH 连接，最多 6 路并发 grep。
- 默认按文件末尾字节窗口检索（`tailBytes`，默认 20MB），范围内命中全部返回；`maxCount` / 按行 `fromTail` 只留给旧调用。
- 每个文件最多 50000 行；达到上限后停止该文件检索，不丢已有结果。
- 检索期可用单日/范围按文件最后修改时间自动勾选文件；这只改 `selectedFiles`，不改搜索协议。

不要改回全量 `logLine` 推到 webview，也不要在每次滚动时重新 SSH 取窗口。

## 2. 当前结构

```text
体验窗
  App.tsx          服务器、检索草稿、job 窗口、查找栏、peek 调度
  FileSelectDropdown  已展开文件的分组多选
  RemotePathBrowser   配置期远程目录浏览
  ConfigModal         连接与路径

Go runtime
  search / peek / find / clear
  list_log_files
  browse_remote_path
  load_config / save_config / test_connection
  result_store         serverId → runId → tabId → 行
```

两条路径选择链路是分开的：

| 阶段 | 对象 | 命令 |
|---|---|---|
| 配置连接 | 通配符或目录，如 `/var/log/nginx/*.log` | `browse_remote_path` |
| 开始检索 | 展开后的具体文件 | `list_log_files` |

配置路径决定「能看见哪些文件」；工具栏选择决定「这一次检索哪些文件」。未选文件时，检索仍回退到最近修改的 5 个文件，并在选择器里写明，避免静默默认。

## 3. 路径选择交互

旧交互的问题：配置只能手填；文件选择是扁平下拉，看不清目录关系，也没有最近修改时间。

### 3.1 配置连接：远程浏览

编辑连接时可以：

- 点常用预设（系统日志、Nginx、容器、家目录日志）
- 手填通配符
- 打开「浏览远程」，用未保存的表单配置 SSH 列出目录

浏览器提供：

- 地址栏，支持目录、`~`、通配符预览
- `/var/log`、家目录、`/home`、`/opt` 快捷入口
- 面包屑回退
- 点目录进入，勾选文件后添加
- 「添加此目录 /*」「添加 *.log」
- 输入 `/var/log/nginx/*.log` 可预览匹配结果，再「使用该通配符」

`browse_remote_path` 接受 `server`（未保存表单）或 `serverId`。空路径时远程脚本优先 `/var/log`，否则用家目录。单目录最多列 400 项。

### 3.2 检索工具栏：按目录分组

`list_log_files` 展开配置路径后，选择器按父目录分组：

- 目录可半选、整组勾选
- 排序：最近修改 / 文件名 / 大小
- 快捷：全选、最近 5 个、清空、刷新
- 文件行显示大小和相对时间
- 触发器显示已选文件名，不再只写「已选 N 个」

## 4. 目标状态模型

前端现在仍是一组按 `serverId` 切开的 `Record`。后续应收到一棵树上，对标 `ssh-manager` 的 `useReducer` + Controller：

```text
Workspace
  draft     关键词、过滤、文件选择
  files     远程列表状态
  job?      当前检索
    runId
    tabs[]  status / total / truncated
    viewport  当前 Tab 的 offset + lines
```

`SearchController` 持有 `interact`、peek debounce、跳转待办，只 `dispatch`。组件不要再直接 `invoke`。

命令面建议最终收成：

```text
search.start     interact
search.peek      invoke
search.find      invoke
search.cancel    invoke
browse_remote_path
list_log_files
load/save/test
```

UI 已只用 store，兼容流式 `logLine` 可以删。对外输入用 `query` / `scope`，不要继续把 grep 开关袋当成协议。

SSH 连接按主机指纹缓存在 owned 进程里（空闲 5 分钟、TCP/SSH keepalive、握手 8 秒超时）。浏览、列文件、检索、测连复用同一条连接；凭证变化会换新连接。

## 5. 明确不做

- 不在配置期做完整 SFTP 文件管理（上传、删除、chmod）
- 不把日志工具和 SSH 管理器的主机库强行合并（可以后做）
- 不把浏览结果当检索结果；浏览只写入配置路径
- 不在 renderer 缓存全量日志行

## 6. 落地顺序

已经做完：远程浏览命令、配置期点选路径、检索期分组选择、本文档。

已做完：远程浏览、配置期点选路径、检索期分组选择、Go 侧 SSH 连接复用、具体文件跳过 expand、远程最新 N 条提前终止。

下一步按这个顺序，不要和路径交互绑在一起改：

1. 前端收成 Workspace + reducer + `SearchController`
2. 去掉 `search` 的 stream 双模式
3. 再加 follow / 检索历史 / 共用主机库

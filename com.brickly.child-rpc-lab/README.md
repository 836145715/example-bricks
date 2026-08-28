# 子窗 RPC 实验室

用来手测 runtime 子窗的 `notify` / `request` / `expose` / `send`。

## 导入

1. 在本目录执行 `npm run setup -- --local`，把 runtime 指到旁边的 `ai-bricks` SDK。
2. 桌面「开发工作区」加入 `example-bricks` 或本目录。
3. 打开 **子窗 RPC 实验室**。

主进程如果刚改过子窗协议，先重启 `npm run dev`。

## 怎么测

体验窗先 `start({ allowStandaloneWindows: true })`，再开子窗：

| 按钮 | 预期 |
| --- | --- |
| 打开 attached | invoke 一直转，直到关掉子窗才返回 |
| 打开 standalone | invoke 马上返回，子窗还在，里面的按钮继续能用 |

子窗里：

| 按钮 | 预期 |
| --- | --- |
| `parent.echo` | 立刻拿到 `{ echo, kind }` |
| `notify('ping')` | 页面没有返回值；runtime 日志有 `notify ping` |
| `request('import')` | 先看到 5 次 `onEvent` 进度，再拿到结果 |
| `request('hang')` | 不填 timeout，不会自己断；点「取消」才停 |
| 2 秒超时的 hang | 约 2 秒后 `[REQUEST_TIMEOUT]` |
| `parent.noSuch()` | `[NOT_EXPOSED]` |
| tick | 每秒一条，来自 runtime `win.send` |
| `window.close()` | 关窗；attached 那次 invoke 这时才返回 |

子窗顶上应显示 `brick-child · 无 invoke/start`。

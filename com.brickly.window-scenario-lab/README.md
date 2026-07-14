# 窗口场景测试台

status: active  
type: brick  
id: `com.brickly.window-scenario-lab`  
related_code: `runtime/node/index.js`, `ui/control.*`, `ui/child.*`

专门覆盖 **多窗口场景** 的测试工具，与「窗口 API 实验室」（测 BrowserWindow 方法白名单）互补：

| 工具 | 侧重点 |
|------|--------|
| `demo-window-lab` | 单窗 API 方法全集 |
| **window-scenario-lab** | 单例/多窗、ensure vs new、创建时绑定、生命周期流、跨窗消息 |

## 覆盖场景

1. **控制台单例 ensure**：`open-control` 有则 focus，不重复建。  
2. **场景窗 ensure / new**：同 scenario 复用 vs 强制新建。  
3. **多窗并存**：套件一键打开 standard/compact/frameless/always-on-top/…  
4. **创建时绑定**：每个 `WindowHandle` 在 create 后 `on('message'|'closed'|'focus'|…)`，不靠全局 `windowId` 过滤。  
5. **生命周期事件流**：focus/blur/show/hide/move/resize → 控制台日志。  
6. **跨窗消息**：控制台 Ping → 子窗 pong；子窗 log → 控制台。  
7. **关闭策略**：关单个 / 关全部子窗（保留控制台）/ 进程 shutdown 全关。  
8. **命令短命**：create/focus 后命令立即返回；实例靠 child-window lease 保活。

## 预设场景

| id | 说明 |
|----|------|
| `standard` | 标准有边框窗 |
| `compact` | 小窗 |
| `frameless` | 无边框 |
| `always-on-top` | 置顶 |
| `skip-taskbar` | 不进任务栏 |
| `fixed` | 不可缩放 |
| `transparent` | 透明底 + 无边框 |
| `wide` / `tall` | 宽条 / 竖条 |
| `offset` | 指定 x/y |

## 命令

- `open-control` — 打开控制台  
- `open-scenario` — `{ scenario, mode: ensure|new, title? }`  
- `open-suite` — `{ mode, scenarios? }`  
- `list-win-sessions` / `focus-win-session` / `close-win-session` / `close-all`  
- `ping-win-session` — `{ windowId, text? }`

## Runtime 模块

| 文件 | 职责 |
|------|------|
| `index.js` | 入口：注册命令、注入依赖、`start` |
| `scenarios.js` | 场景预设与套件列表 |
| `win-session-store.js` | `WinSession` Map、scenario 索引、control 窗 id |
| `notify.js` | `webContents.send` + 无 ALS 时排队 flush |
| `bind-win-session.js` | create 后绑 handle 事件 |
| `open-windows.js` | open/focus/close/ping |
| `control-messages.js` | `sendToParent` 协议分发 |

## 本地依赖

```bash
cd example-bricks/com.brickly.window-scenario-lab/runtime/node
npm install
```

## 使用

1. 开发工作台导入/刷新本目录。  
2. 运行 **打开控制台（单例）**。  
3. 在控制台用 ensure/new 打开场景，或一键套件。  
4. 观察右侧日志的生命周期事件；对子窗 Ping / bounds / 关闭。

## 设计对照（对话结论落地）

- 复用逻辑在 **runtime**（Map + scenarioIndex），宿主 create 仍是新建。  
- 有窗则 window lease 保活，变量仍在，可 focus。  
- 事件用 **handle 绑定**，多窗不靠全局 if。  
- 命令结束即释放 invoke；不随窗口寿命挂起。

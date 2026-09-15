# com.brickly.air-strike · 空袭准星

整蛊特效砖：按热键进入瞄准模式，鼠标变成红色圆圈准星；左键把准星钉在屏幕上，片刻后一枚导弹呼啸而下——爆炸、闪光。

## 玩法

1. 按 `Ctrl+Shift+B`（macOS `Cmd+Shift+B`）或从命令面板跑 `strike`。
2. 全屏透明覆盖层进入瞄准模式（桌面实时可见，系统光标不隐藏），红色准星跟随鼠标。
3. 左键点击任意位置 → 准星钉住并开始蜂鸣，同时覆盖层立刻鼠标穿透（`setIgnoreMouseEvents`），动画期间桌面恢复可操作 → 导弹落下 → 爆炸 + 白闪 → 留下焦痕后窗口自动关闭。
4. 瞄准时 `Esc` 或右键取消；再按一次热键直接重新瞄准。

## 实现要点

- `runtime.instance: shared` + `execution: parallel`：同一进程复用，重复触发热键会顶掉上一局而不是排队。
- 覆盖窗走 `ctx.ui`（Call 绑定）：命令期间窗活着，命令一结束（命中/取消/超时/被宿主取消）窗口自动回收，不需要 `keepAlive`。
- 页面经 `window.brickly.request` ↔ runtime `win.expose` 握手：`strike:init` 取参数，`strike:done` / `strike:cancel` 结算命令；`brickly.notify('strike:locked')` 走同一张 expose 表，命中即 `setIgnoreMouseEvents(true)` 放行鼠标。
- 音效用 WebAudio 现场合成（锁定蜂鸣、下落啸叫、爆炸低频噪声），无外部资源。

## 参数

`strike` 命令输入：

- `lockDelayMs`（200–5000，默认 800）：锁定到导弹落地的间隔。
- `mute`（默认 false）：静音。

输出：`target`（命中点屏幕 DIP 坐标）、`exploded`、`cancelled`。

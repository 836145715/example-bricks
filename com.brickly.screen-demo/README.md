# 屏幕取色测试 Brick

这个 Brick 是 `host.platform.screen.*` 的最小调用示例，用于手测当前分支合入的屏幕取色和区域截图能力。

## 命令

- `pick-color`：调用 `host.platform.screen.pickColor`，返回 `{ hex, rgb }`。
- `capture-region`：调用 `host.platform.screen.captureRegion`，用 `format: "dataUrl"` 返回可直接渲染的图片对象。

## 权限

manifest 只声明 `os.screenshot`。本示例不写自定义文件路径，因此不需要 `fs.write`。

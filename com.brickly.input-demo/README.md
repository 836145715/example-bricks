# com.brickly.input-demo

用于手工验证 `host.platform.input.*` 的演示 Brick。

## 使用方式

1. 在 `Brickly` 目录运行 `npm run dev`。`predev` 会自动构建当前平台的 input helper。
2. 在 Brickly 中刷新 Brick 列表，找到「模拟输入测试」。
3. 运行「输入短文本」命令，保持默认 `delayMs=2500`。
4. 点击运行后，立刻切到记事本、浏览器输入框或其它目标窗口。
5. 延迟结束后应该看到 `hello brickly 123` 被输入到当前焦点位置。

鼠标命令使用屏幕绝对坐标，默认会移动到 `(100, 100)`。测试点击前请确认坐标位置，避免误点重要按钮。

## 权限

Manifest 声明了 `os.input`。这是高风险宿主能力，只用于开发测试和明确用户触发的自动化命令。

macOS 可能需要在系统设置里给 Brickly 授予「辅助功能」权限，否则系统可能拒绝模拟输入事件。

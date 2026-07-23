---
status: active
type: brick-note
related_code: manifest.json,runtime/node/index.js,runtime/node/src
last_verified: 2026-05-29
---

# GLM 截图 OCR 标注

`com.brickly.glm-ocr-screenshot` 提供截图 OCR 组合能力：

1. 通过系统截图工具让用户框选屏幕区域。
2. 使用 Brickly Node SDK 调用 `com.brickly.glm-tools` 的 `ocr` 命令。
3. 按命令形态返回纯文本 OCR 结果，或打开 H5 弹窗绘制截图、OCR 位置框和文字结果。

当前截图能力由宿主 `host.platform.screenshot.selectRegion` 统一提供：

- 宿主截取鼠标所在屏幕的冻结帧。
- 弹出置顶覆盖窗口让用户框选区域。
- 宿主裁剪框选区域并保存 PNG，runtime 只消费返回的文件路径。

本 Brick 只负责调用宿主截图能力、上传 OCR、组装渲染数据和开窗；不再自行直接适配各平台截图工具。

Manifest 声明 `dependencies.com.brickly.glm-tools.commands=["ocr"]`。这一个依赖声明同时用于依赖展示、开发期类型生成和运行时跨 Brick 调用授权。

## 命令边界

- `capture-annotate`：面向用户的可见命令。截图后调用 GLM OCR，并打开标注窗口展示截图、识别框和文字结果。
- `capture-text`：隐藏命令，供其它 Brick 复用。截图后调用 GLM OCR，只返回 `wordsText`、`wordsResult`、`ocrResponse`、可选 `screenshotPath` 和截图区域 `bounds`，不打开标注窗口。`com.brickly.context-pilot` 使用该命令完成截图 OCR 后的句子翻译解构，`com.brickly.quick-translate` 使用 `bounds` 将截图翻译覆盖层贴回原屏幕位置。

## 渲染方式

runtime 只负责框选截图、上传 OCR、组装渲染数据和开窗；截图标注由 `ui/result.html`、`ui/result.css`、`ui/result.js` 在子窗口中完成。子窗口通过 `window.brickly.on('ocr:render')` 接收 runtime 用 `win.webContents.send` 推送的截图 dataURL 和 OCR 明细。

为避免命令返回后窗口被宿主立即回收，本 Brick 使用 `lifecycle.state: "stateless"` + `idleTimeoutMs: 600000`，窗口持有 lease 期间进程保活，空闲后再回收。

## 热键触发

Manifest 为 `capture-annotate` 声明 `capture-annotate` 热键，底座注册成功后会直接调用该命令，并复用截图、OCR 和开窗逻辑。

热键默认不启用，用户可以在热键管理中启用或改绑。热键触发可通过 Profile 配置 `hotkeyLanguageType`、`hotkeyProbability`、`hotkeyKeepScreenshot` 和 `hotkeyOutputDir` 调整默认参数。

## 计费与隐私

截图文件会上传到 `com.brickly.glm-tools` 配置的 BigModel OCR 接口，并可能产生费用。当前运行时不再要求额外传入 `confirmPaidApiCall`；命令触发后会直接进入截图、上传和结果标注流程。

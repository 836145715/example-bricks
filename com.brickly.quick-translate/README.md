# 快速划词翻译 Brick 交接说明

本文面向后续维护者，记录 `com.brickly.quick-translate` 的现有功能、运行流程、关键协议和已知边界。当前实现包含“划词后翻译英文到中文”和“截图 OCR 后覆盖翻译”两条路径，依赖 OpenAI Brick 提供实际模型调用能力，并复用 GLM OCR Screenshot Brick 的截图识别能力。

## 功能概览

- 通过 manifest 注册 `translate-selection` 命令和默认热键：双击 `Ctrl`。
- 触发后模拟 `Ctrl+C`，通过剪贴板前后快照判断当前是否存在新的文本选区。
- 仅在检测到新的文本选区时翻译；默认提示词将英文翻译为自然、准确、简洁的简体中文。
- 调用 `com.brickly.openai` 的 `chat-completions` 命令，并使用流式输出。
- 在鼠标附近打开或复用无边框、透明背景、置顶的翻译浮窗。
- 浮窗支持拖拽、关闭、复制译文；译文流式追加，窗口高度随内容自适应。
- 检测完选区后会尝试恢复触发前的剪贴板内容，避免覆盖用户原剪贴板。
- 通过 manifest 注册 `translate-screenshot-overlay` 命令和默认热键：Windows/Linux `Ctrl+Alt+T`，macOS `Command+Option+T`。
- 截图覆盖翻译会框选屏幕区域，调用 `com.brickly.glm-ocr-screenshot/capture-text` 获取 OCR 文本块和截图屏幕坐标，再调用 OpenAI 批量翻译。
- 运行时使用 `sharp` 生成覆盖图：先用截图周围背景柔化遮盖原文字，再把中文译文绘制到对应 OCR 文本块位置。
- 覆盖图以透明、无边框、置顶窗口贴到原框选区域，按 `Esc` 或右键关闭。

## 运行时流程

核心流程位于 `runtime/node/index.js` 的 `translate-selection` 命令处理器中：

1. 读取触发前剪贴板快照 `before`，主要依赖 `kind`、`hash`、`text` 等字段。
2. 调用 `host.platform.input.keyboardTap` 模拟 `Ctrl+C`。
3. 等待短暂 settle 时间后读取触发后剪贴板快照 `after`。
4. 对比 `before.hash` 与 `after.hash`：
   - `after.kind !== 'text'` 时认为没有可翻译文本。
   - `after.text` 为空时认为没有选区文本。
   - `before.hash === after.hash` 时认为剪贴板没有变化，不翻译旧剪贴板。
5. 尝试用 `before` 恢复剪贴板，恢复失败只记录日志，不中断主流程。
6. 若没有有效选区，直接返回 `{ translated: false, reason }`，不会打开浮窗，也不会调用 OpenAI。
7. 若有有效选区：
   - 通过鼠标位置与最近屏幕工作区计算浮窗位置。
   - 打开或复用翻译窗口。
   - 向 UI 发送 `translate:start`。
8. 调用 `ctx.invokeStream('com.brickly.openai', 'chat-completions', input)`：
   - 收到文本 chunk 时累积译文并发送 `translate:delta`。
   - 收到 result 时提取最终译文并发送 `translate:result`。
   - 收到错误或异常时发送 `translate:error` 并向上抛出。

`translate-screenshot-overlay` 命令流程：

1. 调用 `com.brickly.glm-ocr-screenshot/capture-text`，传入 `keepScreenshot: true`，让 OCR Brick 保留截图文件并返回 `bounds`。
2. 从 `wordsResult[].words` 和 `wordsResult[].location` 提取 OCR 文本块；若无文本块，返回 `{ translated: false, reason: "ocr-empty" }`。
3. 调用 `com.brickly.openai/chat-completions`，要求返回同长度 JSON 数组，字段为 `index` 和 `translatedText`。
4. 使用 `runtime/node/src/screenshot-overlay-renderer.js` 基于 `sharp` 输出覆盖 PNG。
5. 使用 `runtime/node/src/screenshot-overlay-window.js` 创建与 `bounds` 一致的透明置顶窗口，并向 `ui/overlay.html` 发送覆盖图路径。
6. 覆盖窗口收到 `quick-translate-overlay:close` 后关闭；UI 侧按 `Esc` 或右键会发送该消息。

UI 侧 `ui/app.js` 监听以下事件：

- `translate:start`：重置状态、显示原文、禁用复制按钮。
- `translate:delta`：追加流式译文片段，并请求窗口高度调整。
- `translate:result`：显示最终译文，启用复制按钮。
- `translate:error`：展示错误态，保持窗口可关闭。

## 关键文件说明

- `manifest.json`：声明 Brick 元信息、权限、热键、命令、运行时入口，以及对 `com.brickly.openai/chat-completions` 和 `com.brickly.glm-ocr-screenshot/capture-text` 的依赖。
- `runtime/node/index.js`：Node 运行时入口，包含剪贴板检测、窗口创建/复用、屏幕定位、OpenAI 流式调用、窗口消息转发与关闭逻辑。
- `runtime/node/src/screenshot-overlay-renderer.js`：截图覆盖翻译的图片渲染模块，负责用 `sharp` 抹除原文字区域并绘制中文译文。
- `runtime/node/src/screenshot-overlay-window.js`：截图覆盖层窗口模块，负责按截图 `bounds` 创建透明置顶窗口、发送图片路径和处理关闭消息。
- `runtime/node/package.json`：声明 `@syllm/brickly-sdk` npm 依赖。它是运行时与宿主通信的适配层，SDK 协议变更后更新并发布 SDK 包即可。
- `runtime/node/package.json` / `package-lock.json`：声明截图覆盖翻译所需的 `sharp` 运行时依赖。
- `ui/index.html`：浮窗 DOM 结构，包含状态栏、拖拽区域、复制/关闭按钮、原文、译文和错误展示区域。
- `ui/app.js`：浮窗交互逻辑，负责监听 `translate:*` 事件、追加流式文本、复制译文、关闭窗口和请求 resize。
- `ui/style.css`：浮窗视觉样式，包含透明磨砂背景、无边框窗口适配、拖拽区域、流式光标和自适应内容区域。
- `ui/overlay.html` / `ui/overlay.js` / `ui/overlay.css`：截图覆盖层 UI，只显示渲染后的覆盖图，并支持 `Esc` 或右键关闭。
- `smoke.cjs`：本 Brick 的轻量 smoke 测试，通过模拟宿主协议验证无选区、新选区、剪贴板恢复、开窗、流式 OpenAI 调用与关闭窗口。

## 关键协议与依赖

当前实现依赖以下宿主能力和 Brick 间调用协议：

- `host.platform.clipboard.readContent()`：读取剪贴板快照，用于获取 `kind`、`hash`、`text`、文件路径或图片资源等信息。
- `host.platform.clipboard.setContent(content)`：恢复触发前剪贴板内容，目前支持文本、文件路径、部分图片路径形式。
- `host.platform.input.keyboardTap('c', 'control')`：模拟复制当前选区。
- `host.platform.screen.getCursorScreenPoint()`：获取当前鼠标位置，用于浮窗定位。
- `host.platform.screen.getDisplayNearestPoint(point)`：获取最近显示器工作区，避免浮窗超出屏幕。
- `ctx.invokeStream('com.brickly.openai', 'chat-completions', input)`：调用 OpenAI Brick 的 Chat Completions 流式接口。
- `ctx.invoke('com.brickly.glm-ocr-screenshot', 'capture-text', input)`：截图并返回 OCR 文本、OCR 明细、截图路径和框选区域 `bounds`。
- `ctx.invoke('com.brickly.openai', 'chat-completions', input)`：截图翻译路径使用非流式调用，请求模型返回 JSON 翻译数组。

运行时向浮窗发送的内部事件为：

- `translate:start`
- `translate:delta`
- `translate:result`
- `translate:error`

浮窗向运行时发送的内部消息为：

- `quick-translate:close`
- `quick-translate:resize`

截图覆盖窗口使用的内部事件为：

- `quick-translate-overlay:render`
- `quick-translate-overlay:ready`
- `quick-translate-overlay:close`

## 重要边界和坑

- 没有选区时不会弹窗，也不会调用 OpenAI。
- 剪贴板 hash 不变时不会翻译旧剪贴板内容，这是防止误翻用户历史剪贴板的关键保护。
- 剪贴板恢复是 best-effort：恢复失败只写运行时日志，不会阻断翻译。
- 图片、富文本、特殊格式或复杂多格式剪贴板可能无法完整恢复。当前恢复逻辑只覆盖文本、文件路径和部分图片路径。
- 当前会对选中文本 `trim()`，并最多发送 `MAX_SOURCE_CHARS` 个字符，避免超长选区直接冲击模型调用。
- 浮窗高度由 UI 根据 `.shell` 内容高度请求调整，再由运行时限制在最小和最大高度之间。
- 拖拽依赖 Electron 风格的 `-webkit-app-region: drag/no-drag`：可拖拽区域在 `.header`，按钮和正文必须保持 `no-drag`，否则点击、复制、选中文本会失效。
- 窗口是无边框、透明、置顶且不进任务栏的临时工具窗；关闭后会清理缓存引用。
- 截图覆盖翻译依赖截图结果返回 `bounds`；如果宿主或 OCR Brick 未透出框选区域坐标，运行时会拒绝贴回原位置。
- 截图覆盖翻译会保留原始截图文件给 `sharp` 读取，并生成覆盖 PNG；当前没有在覆盖窗口关闭后自动清理这些临时文件。
- OCR `location` 坐标按截图图像像素解释，覆盖窗口按 `bounds` 贴回屏幕 DIP 坐标；高 DPI 场景依赖宿主截图裁剪和窗口 bounds 保持一致。
- `@syllm/brickly-sdk` 是运行时 SDK。主仓库 SDK 或宿主协议变更后，需要发布新版 SDK，并在 `runtime/node/package.json` 中升级依赖后重新跑 smoke。
- 当前 manifest 权限包含 `os.screenshot`，实际运行时主要使用 screen 定位能力；后续如果权限模型细分，需要重新核对权限声明。

## 手动验证步骤

1. 确认 `com.brickly.openai` 已安装、可用，并已配置可调用 Chat Completions 的模型/API Key。
2. 在任意文本应用或网页中选中一段英文文本。
3. 双击 `Ctrl`。
4. 预期鼠标附近出现无边框翻译浮窗，状态从“正在翻译”进入“正在输出”，译文逐步流式出现。
5. 点击“复制”，确认译文写入剪贴板。
6. 点击关闭按钮，确认浮窗关闭。
7. 不选中文本时双击 `Ctrl`，确认不弹窗、不调用 OpenAI。
8. 用已有剪贴板内容重复触发但不产生新选区，确认不会翻译旧剪贴板。
9. 触发前复制一段文本，翻译完成后确认原剪贴板内容尽量被恢复。
10. 在屏幕边缘触发，确认浮窗不会明显越界；在译文较长时确认窗口高度自适应且正文可滚动。
11. 按 `Ctrl+Alt+T`（macOS 为 `Command+Option+T`）触发截图覆盖翻译，框选一块含英文的屏幕区域。
12. 预期原框选区域出现一张贴回原位的翻译覆盖图，英文区域被背景近似抹除并显示中文译文。
13. 按 `Esc` 或右键，确认覆盖窗口关闭。

## Smoke 验证

在 Brick 目录执行：

```powershell
node .\smoke.cjs
```

预期输出：

```text
OK: quick-translate smoke passed
```

该 smoke 覆盖：

- 无选区时返回 `translated: false`。
- 无选区时不开窗、不调用 OpenAI。
- 有选区时恢复旧剪贴板。
- 有选区时创建透明无边框窗口。
- 调用 `com.brickly.openai/chat-completions` 且使用 stream。
- 向 UI 发送 `translate:start`、`translate:delta`、`translate:result`。
- UI 关闭消息会触发窗口关闭。
- 截图覆盖翻译会调用 GLM OCR Brick、调用 OpenAI JSON 翻译、生成覆盖图片，并按截图 `bounds` 创建透明置顶 overlay。
- overlay UI 关闭消息会触发覆盖窗口关闭。

## 后续扩展建议

- 语言方向配置：支持英译中、中译英、自动检测语言，以及自定义目标语言。
- 快捷键配置：允许用户修改双击 Ctrl 的触发方式，或增加备用热键。
- 错误态优化：区分 OpenAI 未配置、网络失败、限流、空结果、权限不足等错误，并提供更明确的操作提示。
- 翻译历史：可选保存原文、译文、时间和来源应用，支持搜索、复制和清空。
- 模型与提示词配置：允许选择模型、温度、术语表、翻译风格或专业领域。
- 剪贴板恢复增强：在宿主支持更多格式后，补齐富文本、HTML、多格式图片等恢复能力。
- 窗口体验优化：支持固定窗口、展开原文、重新翻译、复制原文、自动隐藏或跟随下一次选区复用。

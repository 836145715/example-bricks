# ContextPilot 语境领航员交接说明

本文记录 `com.brickly.context-pilot` 的实现计划、当前完成状态、运行流程与后续维护边界。该 Brick 基于 `com.brickly.quick-translate` 的 runtime 工具形态复制演进，但产品目标不同：它不是“更强翻译器”，而是面向技术英文阅读的划句解构面板。

## 实现计划与状态

- [x] 复制 `quick-translate` 的 runtime 型 Brick 骨架，使用 `@syllm/brickly-sdk` npm 依赖、剪贴板选区检测、鼠标附近弹窗、无边框窗口和流式调用基础能力。
- [x] 新建独立 Brick ID：`com.brickly.context-pilot`，命令为 `analyze-selection`，默认热键仍为双击 `Ctrl`。
- [x] 继续使用“复制前后剪贴板 hash 对比”检测真实选区，避免无选区时读取历史剪贴板。
- [x] 继续在检测后 best-effort 恢复用户原剪贴板内容。
- [x] 将 OpenAI 调用从“只翻译”改为“协议化 Markdown 解构”，避免 UI 强依赖不稳定 JSON。
- [x] 将窗口 UI 改为精简解构面板，分区展示自然翻译、结构直译、句子主干、短语拆解和表达公式。
- [x] 保留流式输出：模型 chunk 到达后立即追加，UI 按 section 增量渲染。
- [x] 增加截图 OCR 入口：调用 `com.brickly.glm-ocr-screenshot.capture-text` 识别截图文字，再复用同一套解构面板。
- [x] 为截图 OCR 解构注册独立热键：Windows/Linux 默认 `Control+Alt+O`，macOS 默认 `Command+Option+O`。
- [x] 补充 smoke 测试，覆盖无选区、有选区、剪贴板恢复、截图 OCR、开窗、流式 OpenAI、窗口事件。

## 功能定位

ContextPilot 面向经常阅读英文技术文档的学习者。用户可以选中一句或一段英文后双击 `Ctrl`，也可以按截图 OCR 热键框选屏幕区域。工具会在鼠标附近弹出无边框浮窗，帮助用户像 inspect 代码一样拆开英文结构。

当前第一版只做阅读辅助：

- 自然翻译：给出可直接理解的中文。
- 结构直译：尽量保留英文语序，帮助对齐结构。
- 句子主干：提取 S / V / O-C 与核心英文骨架。
- 短语拆解：解释介词短语、分词短语、后置修饰、并列结构等技术文档常见结构。
- 表达公式：沉淀可复用的技术表达模板和例句。

暂不做 Dashboard、历史库、造句沙盒和长期学习数据。这些应作为后续产品层能力接入。

## 触发流程

核心流程位于 `runtime/node/index.js`：

### 划词解构

1. `analyze-selection` 被热键触发。
2. 调用 `ctx.platform.clipboard.readContent()` 读取触发前剪贴板快照。
3. 调用 `ctx.platform.input.keyboardTap` 模拟复制当前选区：macOS 使用 `Meta+C`（Command+C），其他平台使用 `Control+C`。
4. 等待 `COPY_SETTLE_MS` 后再次读取剪贴板快照。
5. 使用 `selectedTextFromSnapshots(before, after)` 判断是否存在新文本：
   - `after.kind !== 'text'`：不处理。
   - `after.text` 为空：不处理。
   - `before.hash === after.hash`：认为没有新选区，不处理历史剪贴板。
6. 调用 `restoreClipboard(ctx, before)` 尝试恢复触发前剪贴板。
7. 无有效选区时直接返回 `{ analyzed: false, reason }`，不打开窗口、不调用 OpenAI。
8. 有有效选区时创建或复用浮窗，发送 `context-pilot:start`。
9. 调用 `ctx.invokeStream('com.brickly.openai', 'chat-completions', input)`。
10. 收到流式 chunk 后发送 `context-pilot:delta`。
11. 最终发送 `context-pilot:result` 或 `context-pilot:error`。

这些窗口消息的 payload 不再由 ContextPilot 生成 `analysisId`。Node SDK 和宿主会自动写入宿主生成的 `requestId`，即本次 `command.invoke.id`；UI 只处理当前 `requestId` 的 start/delta/result/error，避免多次触发时旧模型流污染新面板。

### 截图 OCR 解构

1. `analyze-screenshot` 被独立热键触发。
2. 调用 `ctx.invoke('com.brickly.glm-ocr-screenshot', 'capture-text', ...)`。
3. `capture-text` 弹出系统截图框选交互，调用 GLM OCR 后返回 `wordsText`。
4. `normalizeOcrText(ocrResult)` 提取文本；如果为空，返回 `{ analyzed: false, reason: 'ocr-empty-text' }`，不开窗、不调用 OpenAI。
5. 有文本时复用 `analyzeSourceText`，打开同一个 ContextPilot 面板并调用 OpenAI 输出协议化 Markdown。

## 协议化 Markdown 策略

本工具刻意不要求模型输出 JSON。原因是流式 JSON 容易出现半截内容、字段缺失、混入解释文字或格式损坏，直接绑定 UI 风险较高。

当前采用固定 section 标记：

```text
[SECTION:natural_translation]
[SECTION:literal_translation]
[SECTION:skeleton]
[SECTION:chunks]
[SECTION:patterns]
```

UI 侧 `ui/app.js` 使用宽松解析：

- 按行匹配 `[SECTION:key]`。
- 已出现的 section 立即渲染。
- 缺失 section 显示“等待输出”。
- 如果模型没有输出任何 section，退化为 fallback 全文展示。

这使得用户体验优先于结构化数据稳定性：当前阅读面板可以流式显示；未来如果要做学习数据或 Dashboard，可在最终 Markdown 完成后另做后台结构化提取。

## 窗口事件

runtime 向 UI 发送：

- `context-pilot:start`
- `context-pilot:delta`
- `context-pilot:result`
- `context-pilot:error`

上述消息的对象 payload 会携带宿主 `requestId`。UI 侧收到新的 `context-pilot:start` 后把它设为当前轮次，之后忽略其它 `requestId` 的 delta/result/error。维护时不要重新引入插件自生成的 `analysisId`。

UI 向 runtime 发送：

- `context-pilot:close`
- `context-pilot:resize`

窗口配置为无边框、透明背景、置顶、不进任务栏，并通过 `hasShadow: false` 去掉系统外层阴影。拖拽区域在 `.header`，按钮和内容区域需要保持 `-webkit-app-region: no-drag`，否则会影响点击、复制和选中文本。

## 关键文件

- `manifest.json`：声明 Brick ID、划词/截图命令、两个热键、权限、OpenAI 依赖和 GLM OCR 文本依赖。
- `runtime/node/index.js`：选区检测、剪贴板恢复、截图 OCR 文本提取、窗口生命周期、OpenAI 流式解构调用。
- `runtime/node/package.json`：声明 `@syllm/brickly-sdk` npm 依赖；宿主协议变更后更新并发布 SDK 包即可。
- `ui/index.html`：解构面板 DOM。
- `ui/app.js`：协议化 Markdown 解析、流式渲染、复制、关闭、resize。
- `ui/style.css`：无边框浮窗、精简分区、拖拽区域和流式文本样式。
- `smoke.cjs`：本 Brick 的轻量协议 smoke 测试。

## 验证方式

在本目录执行：

```powershell
node .\smoke.cjs
```

预期输出：

```text
OK: context-pilot smoke passed
```

该 smoke 覆盖：

- 无选区时返回 `{ analyzed: false }`。
- 无选区时不开窗、不调用 OpenAI。
- 有选区时恢复旧剪贴板。
- 截图 OCR 命令会调用 `com.brickly.glm-ocr-screenshot.capture-text`。
- OCR 为空时不开窗、不调用 OpenAI。
- 有选区时创建透明无边框窗口。
- 调用 `com.brickly.openai/chat-completions` 且使用 stream。
- prompt 使用协议化 section。
- UI 收到 `context-pilot:start/delta/result`，且消息使用宿主 `requestId` 做轮次隔离。
- UI 关闭消息会触发窗口关闭。

## 已知边界

- 当前选区检测依赖模拟系统复制快捷键，在禁止复制或焦点异常的应用中可能无法工作。
- 剪贴板恢复是 best-effort，只覆盖文本、文件路径和部分图片路径形式；复杂富文本、多格式剪贴板不保证完整恢复。
- 截图 OCR 入口依赖 `com.brickly.glm-ocr-screenshot` 和其下游 `com.brickly.glm-tools` 配置；GLM OCR 未配置、截图取消或识别为空时不会进入 OpenAI 解构。
- `MAX_SOURCE_CHARS` 会截断超长选区，避免一次性把大段文档送入模型。
- 输出质量依赖 `com.brickly.openai` 配置和模型能力；OpenAI 未配置或调用失败时 UI 只显示错误态。
- section 解析是宽松策略，不保证每个 section 都存在。UI 必须能接受缺失内容。
- 当前只做英文技术文档到中文辅助解构，不做语言自动识别和用户可配置 prompt。

## 后续扩展建议

- 增加“保存句型”并记录 section 中的 `patterns`。
- 在最终 Markdown 完成后异步提取结构化标签，用于 Dashboard。
- 加入 Sandbox：从某个表达公式进入造句练习，AI 像编译器一样纠错。
- 增加 prompt 配置：目标语言、技术领域、解释详细程度。
- 支持网页插件形态，直接在页面句子旁展示轻量解构。

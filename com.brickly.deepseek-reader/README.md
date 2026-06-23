---
status: active
type: brick-note
related_code: manifest.json,src/App.tsx,runtime/python/main.py
last_verified: 2026-05-26
---

# DeepSeek Markdown 导出

`com.brickly.deepseek-reader` 是一个单体 DeepSeek 分享链接导出工具。旧的
`com.brickly.deepseek-share` 能力已经合并进本 Brick，不再作为外部依赖存在。

当前只保留一个隐藏命令：

- `save`：输入 DeepSeek 分享链接或 ID、保存目录、是否包含思考过程，拉取分享内容并在用户选择的目录内自动生成 Markdown 文件。

UI 只提供分享链接输入、思考过程开关和“选择目录并导出”。本地 JSON 解析/导出入口已移除，能力声明中也不再暴露 `parse`、`fetch` 或 `save-json`。

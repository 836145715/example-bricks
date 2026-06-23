---
status: active
type: brick-note
related_code: manifest.json,runtime/node/index.js,runtime/node/src
last_verified: 2026-05-29
---

# GLM 工具 API

`com.brickly.glm-tools` 封装智谱 BigModel 工具 API。当前接入：

- `web-search`：网络搜索，`POST /paas/v4/web_search`
- `reader`：网页阅读，`POST /paas/v4/reader`
- `moderate-content`：内容安全，`POST /paas/v4/moderations`
- `parse-file-sync`：同步文件解析，`POST /paas/v4/files/parser/sync`
- `create-file-parse-task`：异步文件解析任务，`POST /paas/v4/files/parser/create`
- `get-file-parse-result`：异步解析结果，`GET /paas/v4/files/parser/result/{taskId}/{format_type}`
- `ocr`：内部 OCR 服务，`POST /paas/v4/files/ocr`

## 配置

需要在 Profile 中配置 `apiKey`。运行时读取顺序：

1. Profile 的 `apiKey`
2. `GLM_API_KEY`
3. `BIGMODEL_API_KEY`
4. `ZHIPUAI_API_KEY`

`baseUrl` 默认是 `https://open.bigmodel.cn/api`。如果后续接入私有网关，可以通过 Profile 或 `GLM_BASE_URL` 覆盖。

## 计费与上传边界

`parse-file-sync` 会把文件上传到 BigModel 同步解析接口，并可能立即产生费用。运行时默认拒绝执行该命令，除非调用输入里显式传入：

```json
{
  "confirmPaidApiCall": true
}
```

这个保护只针对误触发；确认后仍会真实上传文件并调用线上接口。

`ocr` 是供截图 OCR 标注工具复用的内部命令，会把图片上传到 BigModel OCR 接口并可能产生费用，但不再要求 `confirmPaidApiCall`。普通用户入口应优先使用 `com.brickly.glm-ocr-screenshot`。

## 运行时结构

`runtime/node/index.js` 只负责注册命令和输出结果；核心逻辑拆到：

- `src/glm-client.js`：BigModel 工具 API 适配器
- `src/http-client.js`：JSON 与 multipart HTTP 边界
- `src/request-builders.js`：命令输入到 API 请求体/字段的纯转换
- `src/file-source.js`：Brickly file 输入、本地路径和 data URL 的文件归一化
- `src/input.js`：基础输入校验与类型转换

新增 GLM 工具接口时，优先在 `request-builders.js` 增加纯转换，再在 `glm-client.js` 接入端点，最后在 `manifest.json` 暴露命令。

## 验证

```bash
cd bricks/com.brickly.glm-tools/runtime/node
npm test
```

联网端到端调用需要有效 BigModel API Key，本仓库测试只覆盖输入转换、错误归一和文件输入解析，不触发真实 API 费用。

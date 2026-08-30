# Resource Lab 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建一个带工作台 UI 的资源验收 Brick，并用 Node.js、Python、Go 三个辅助 Brick 覆盖公开 SDK 的创建、流式读写、跨语言转交、生命周期、错误和压力场景。

**架构：** Resource Lab 的 Node Runtime 注册场景目录并以独立 runId 调度测试，结果通过命令查询和资源事件增量投递给 React UI。三个 Echo Brick 实现一致的 inspect、produce、transform、relay、hold 和 event-echo 契约，所有资源数据只走公开 SDK。

**技术栈：** Node.js `node:test`、Brickly SDK 0.3.0、Python 3.10+、Go 1.21、React 19、TypeScript 5.9、Vite 7、Lucide React。

---

## 文件结构

### Resource Lab

- `com.brickly.resource-lab/manifest.json`：UI、依赖、事件和命令声明。
- `com.brickly.resource-lab/runtime/node/contracts.cjs`：共享 DTO、状态和脱敏函数。
- `com.brickly.resource-lab/runtime/node/catalog.cjs`：默认、压力、重启场景目录。
- `com.brickly.resource-lab/runtime/node/scenarios.cjs`：公开 SDK 场景实现。
- `com.brickly.resource-lab/runtime/node/run-manager.cjs`：并发、独占、取消和结果聚合。
- `com.brickly.resource-lab/runtime/node/index.cjs`：BricklyRuntime 命令与事件适配。
- `com.brickly.resource-lab/runtime/node/*.test.cjs`：Runtime 单元与契约测试。
- `com.brickly.resource-lab/src/types.ts`：UI DTO。
- `com.brickly.resource-lab/src/brickly.ts`：Renderer 调用与事件订阅。
- `com.brickly.resource-lab/src/App.tsx`：测试工作台状态编排。
- `com.brickly.resource-lab/src/components/*`：工具栏、用例树、结果表和详情面板。
- `com.brickly.resource-lab/src/styles.css`：响应式工作台视觉样式。
- `com.brickly.resource-lab/src/*.test.ts`：UI 状态和适配器测试。

### Echo Bricks

- `com.brickly.resource-echo-node/manifest.json` 与 `runtime/node/index.cjs`：Node 契约实现。
- `com.brickly.resource-echo-python/manifest.json`、`requirements.txt` 与 `runtime/python/main.py`：Python 契约实现。
- `com.brickly.resource-echo-go/manifest.json`、`runtime/go/main.go`、`runtime/go/go.mod`、`runtime/go/build.ps1`：Go 契约实现和跨平台构建。
- 各语言测试验证统一 hash、大小和错误 DTO。

### 验收

- `scripts/test-resource-lab.ps1`：运行四个 Brick 的测试、类型检查、构建和 manifest 校验。
- `scripts/validate-resource-lab-manifests.mjs`：使用 Host manifest schema 校验四个 Brick。
- `docs/resource-lab.md`：安装、默认套件、压力套件和重启验收说明。

### 任务 1：共享契约和场景目录

**文件：**
- 创建：`com.brickly.resource-lab/runtime/node/contracts.cjs`
- 创建：`com.brickly.resource-lab/runtime/node/catalog.cjs`
- 测试：`com.brickly.resource-lab/runtime/node/catalog.test.cjs`

- [ ] **步骤 1：编写失败的目录测试**

测试断言每个场景 id 唯一，分组固定为 `create/read/cross-language/lifecycle/stress`，默认套件不超过 64 MiB，201 MiB 和 1 GiB 只属于压力套件，并验证导出的 ResourceRef 不含 `accessToken`。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test runtime/node/catalog.test.cjs`
预期：FAIL，模块 `catalog.cjs` 尚不存在。

- [ ] **步骤 3：实现最小目录与脱敏契约**

定义 `TEST_STATUS`、`GROUPS`、`catalog`、`sanitizeError()`、`sanitizeResourceRef()` 和 `createResult()`；场景记录包含 `id/group/title/mode/exclusive/sizeBytes/requirements`。

- [ ] **步骤 4：运行测试验证通过并提交**

运行：`node --test runtime/node/catalog.test.cjs`
预期：PASS。

提交：`feat(resource-lab): 定义资源测试场景契约`

### 任务 2：三语言 Echo 契约

**文件：**
- 创建：`com.brickly.resource-echo-node/**`
- 创建：`com.brickly.resource-echo-python/**`
- 创建：`com.brickly.resource-echo-go/**`

- [ ] **步骤 1：先写各语言失败测试**

Node 测试通过伪 ResourceHandle 验证 inspect 的字节数、分块数和 SHA-256；Python 使用 `unittest` 验证同一向量；Go 使用 `go test` 验证 `hashReader`。共享向量为 `hello resource` 和 1 MiB 固定字节。

- [ ] **步骤 2：运行三端测试验证失败**

运行：

```powershell
node --test com.brickly.resource-echo-node/runtime/node/index.test.cjs
python -m unittest discover -s com.brickly.resource-echo-python/runtime/python -p "test_*.py"
Push-Location com.brickly.resource-echo-go/runtime/go; go test ./...; Pop-Location
```

预期：三端因实现缺失失败。

- [ ] **步骤 3：实现统一命令**

三端实现 `inspect`、`produce`、`transform`、`relay`、`hold`、`event-last`。所有读取使用 stream/io.Reader，produce 使用 Writer/createFrom，返回统一 `{runtime,sizeBytes,sha256,chunkCount,mimeType}`。

- [ ] **步骤 4：验证、构建并提交**

运行三端测试；执行 Go `build.ps1` 构建六个平台二进制；校验三个 manifest。

提交：`feat(resource-lab): 添加三语言资源 Echo Brick`

### 任务 3：场景执行器

**文件：**
- 创建：`com.brickly.resource-lab/runtime/node/scenarios.cjs`
- 创建：`com.brickly.resource-lab/runtime/node/run-manager.cjs`
- 测试：`com.brickly.resource-lab/runtime/node/run-manager.test.cjs`
- 测试：`com.brickly.resource-lab/runtime/node/scenarios.test.cjs`

- [ ] **步骤 1：编写调度失败测试**

覆盖最大并发 3、exclusive 场景单独运行、不同 runId 隔离、取消只影响目标 runId、单项完成立即回调、依赖失败转 skipped、cleanup 完成后才进入 cancelled。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test runtime/node/run-manager.test.cjs runtime/node/scenarios.test.cjs`
预期：FAIL，执行器模块缺失。

- [ ] **步骤 3：实现 RunManager 和公开 SDK 场景**

场景覆盖 create/createFrom/Writer、text/json/stream/saveTo、并发流拒绝、提前关闭、invokeResource、Node/Python/Go inspect、transform、多跳 relay、revoke、TTL、伪造 token、abort、64 MiB 和压力大小。场景依赖通过注入的 `resources/invoke/invokeResource/events/temp` 端口调用，便于真实单元测试。

- [ ] **步骤 4：验证并提交**

运行 Runtime 测试，预期全部 PASS。

提交：`feat(resource-lab): 实现资源场景调度器`

### 任务 4：Resource Lab Runtime 与 manifest

**文件：**
- 创建：`com.brickly.resource-lab/manifest.json`
- 创建：`com.brickly.resource-lab/runtime/node/index.cjs`
- 创建：`com.brickly.resource-lab/runtime/node/index.test.cjs`
- 创建：`com.brickly.resource-lab/runtime/node/package.json`
- 创建：`com.brickly.resource-lab/assets/icon.svg`

- [ ] **步骤 1：编写命令适配失败测试**

使用伪 SDK 加载 Runtime，断言注册七个命令、suite-run 保持到批次终态、UI 通过 stream 立即获得可取消句柄、suite-status 返回增量结果、suite-cancel 只取消指定批次、suite-export 返回 ResourceHandle、shutdown 取消全部活跃批次。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test runtime/node/index.test.cjs`
预期：FAIL，入口不存在。

- [ ] **步骤 3：实现 Runtime 适配层和 manifest**

manifest 声明三语言依赖、`event.publish:resource-lab:run-updated`、webview UI 和七个合法 command id。Runtime 发布增量资源事件，重启检查点由 UI localStorage 保存且只含 `runId/pid/nonce/preparedAt`，不持久化 token。

- [ ] **步骤 4：验证并提交**

运行 Resource Lab 全部 Runtime 测试和 manifest 校验。

提交：`feat(resource-lab): 接入测试台 Runtime`

### 任务 5：交互式工作台 UI

**文件：**
- 创建：`com.brickly.resource-lab/package.json`
- 创建：`com.brickly.resource-lab/tsconfig.json`
- 创建：`com.brickly.resource-lab/vite.config.ts`
- 创建：`com.brickly.resource-lab/src/index.html`
- 创建：`com.brickly.resource-lab/src/main.tsx`
- 创建：`com.brickly.resource-lab/src/App.tsx`
- 创建：`com.brickly.resource-lab/src/brickly.ts`
- 创建：`com.brickly.resource-lab/src/types.ts`
- 创建：`com.brickly.resource-lab/src/components/*.tsx`
- 创建：`com.brickly.resource-lab/src/styles.css`
- 测试：`com.brickly.resource-lab/ui-adapter.test.cjs`

- [ ] **步骤 1：编写 UI 适配失败测试**

覆盖命令 id、事件 ResourceHandle `.json()`、按 runId 去重、增量结果合并、停止目标批次、失败项单独重跑和导出资源保存。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，UI 适配器与组件不存在。

- [ ] **步骤 3：实现工作台 UI**

实现顶部工具栏、左侧用例树、中间结果表、右侧详情和底部状态栏。使用 Lucide 图标、固定工具栏尺寸、无嵌套卡片；桌面四区布局，窄屏按结果→用例→详情顺序折叠。每个结果行使用稳定高度并明确显示 passed/failed/skipped/cancelled/waiting-restart。

- [ ] **步骤 4：测试、类型检查、构建并提交**

运行：`npm test`、`npm run typecheck`、`npm run build`。
预期：全部 PASS，生成 `ui/`。

提交：`feat(resource-lab): 构建资源验收工作台`

### 任务 6：完整验收和文档

**文件：**
- 创建：`scripts/test-resource-lab.ps1`
- 创建：`scripts/validate-resource-lab-manifests.mjs`
- 创建：`docs/resource-lab.md`
- 修改：四个 Brick 的测试与构建产物（若验收发现问题）。

- [ ] **步骤 1：编写统一验收脚本**

脚本依次运行 Node/Python/Go Runtime 测试、Resource Lab UI 测试、TypeScript 类型检查、Vite 构建、Go 六平台构建和四个 manifest schema 校验，任一失败立即退出非零码。

- [ ] **步骤 2：运行完整默认验收**

运行：`powershell -ExecutionPolicy Bypass -File scripts/test-resource-lab.ps1`
预期：所有自动化检查通过。

- [ ] **步骤 3：启动 Host 做 UI 验收**

安装/加载四个 Brick，打开 Resource Lab，确认默认套件逐项增量显示、单项重跑和取消隔离可用。使用 Playwright 检查 1440×900、1024×768 和 390×844，无文本溢出、重叠或空白界面。

- [ ] **步骤 4：更新使用说明并最终提交**

文档说明安装、默认/压力套件、跨语言依赖、重启测试和 1 GiB 磁盘要求，不记录 token 或内部存储路径。

提交：`docs(resource-lab): 补充资源测试台验收指南`

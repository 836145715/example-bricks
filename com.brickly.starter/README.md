# com.brickly.starter — 脚手架 Brick

图形化创建新 Brick 工程的向导。**生成内核完全来自 `create-brickly`（CLI）**——本砖只是它的
GUI 衍生品，可在市场安装/卸载；未安装时开发者仍可用 `npx create-brickly` / `npm create brickly`
创建工程，已生成的工具不依赖本砖。

## 架构

```
向导 UI（webview, src/ui）
    │  window.brickly.invoke('<command>', input)
    ▼
runtime（node, src/runtime/index.ts）—— 五个 command 薄壳
    │  ├─ ctx.platform.dev.*        宿主开发目录原语（listBricks/getBrickDetail/rescan）
    │  ├─ brick.getPath('devBricks') 开发目录路径
    │  └─ vendor/create-brickly     create-brickly 库产物（生成逻辑唯一事实来源）
    ▼
开发目录（brick.getPath('devBricks')）→ 生成落盘 → platform.dev.rescan()
```

## 命令

| command | 说明 |
|---|---|
| `list-templates` | CLI 枚举（runtime/uiStack/featurePreset）+ 默认值 |
| `list-bricks` | 开发+已安装工具轻量列表（依赖选择器数据源） |
| `get-brick-detail` | 按完整 BrickRef 取 manifest 作者字段子集 |
| `preview` | 草稿 → 文件清单/manifest/告警，不落盘 |
| `create` | 依赖终校验 → 写入 `brick.getPath('devBricks')/<brickId>` → `dev.rescan()` |

## vendor：create-brickly 怎么进来的

`create-brickly` 未发布 npm 期间，库产物以文件形式 vendored：

```
src/runtime/vendor/create-brickly/
  api.js                          ← 上游 dist/api.js（esbuild 单文件，自包含）
  api.d.ts                        ← 手工维护的最小类型镜像
  schema/manifest.schema.json     ← 上游 schema（manifestSchemaPath 注入）
src/ui/vendor/manifest.schema.json ← Monaco JSON 诊断用同一份
```

刷新：`npm run vendor`（默认取兄弟仓 `../ai-bricks`，或 `node scripts/vendor-create-brickly.mjs <create-brickly目录>`）。
发布 npm 后改为依赖 pin，vendor 退役。

## 开发

```bash
# 本仓根目录，联调本地 SDK（含未发布的 platform.dev.* / getPath('devBricks')）
npm run setup -- --local --brick com.brickly.starter
# 或直接跑砖内脚本
node ../scripts/setup-brick.cjs --local
```

注意：`platform.dev.*` 与 `getPath('devBricks')` 在 SDK 0.12.0 中尚不存在，必须 `--local` 联调源码版 SDK，
或等 SDK 发布后 bump `src/runtime/package.json` 的 pin。

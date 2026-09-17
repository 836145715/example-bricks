---
status: active
type: brick-guide
related_code:
  - src/runtime/index.ts
  - src/ui/src/QuickSearchPage.tsx
  - scripts/quick-search-runtime-smoke.test.ts
last_verified: 2026-09-17
---

# com.brickly.quick-search

快速搜索浮窗砖：聚合全部已开启的搜索 Provider，`Ctrl+Space` 唤起/隐藏，失焦自动隐藏，原生拖拽移动并记忆位置。宿主侧只提供搜索平台服务（Provider 注册、消费方校验、搜索编排），窗口与页面是本砖私产。

- `src/runtime/index.ts`（TS）：常驻 shared 实例，`toggle` 命令显隐，`search.*` expose 中转 + `search:snapshot` 渐进快照转发，`drag.start/end` 原生拖拽。
- `src/runtime/build.mjs`：esbuild 把 `index.ts` + SDK bundle 成单文件 `out/runtime/<平台>/index.js`。
- `src/ui/`：React 19 + Vite + Tailwind 浮窗页面（manifest `ui.type=none`，窗口由 runtime 程序化创建）。

## 联调

```bash
# 本砖依赖尚未发布的 search API（platform.search.* / startDrag），
# 发版前必须用 --local 链接旁边 ai-bricks 的 SDK 源码：
npm run setup -- --local com.brickly.quick-search
# 或：node scripts/setup-brick.cjs --local com.brickly.quick-search
```

`--local` 在 `out/runtime/<平台>` 段内装 esbuild/typescript 等构建依赖，把 `@syllm/brickly-sdk` symlink 到 `../ai-bricks`（或 `BRICKLY_HOME`）的本地包，再执行段内 `build.mjs` 产出 bundle。SDK 发新版后 `npm run sync-sdk` 升 pin。

## 验证

```bash
# runtime 冒烟：真起 out/ 产物进程，gRPC 注册 + toggle 命令路由
npm run test:quick-search

# 类型检查（依赖装在 out 段，在段内跑）
cd out/runtime/win-x64 && npx tsc --noEmit
```

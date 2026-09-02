---
status: active
type: guide
related_code:
  - scripts/setup-brick.cjs
  - scripts/setup-all.cjs
  - scripts/sync-sdk-version.cjs
  - sdk-pin.json
  - check-follower-sdk-versions.cjs
last_verified: 2026-09-02
---

# example-bricks

Brickly 官方示例工具仓库。每个子目录是一个可导入开发工作台的 Brick。

仓库里的 `package.json` / `go.mod` / `pyproject.toml` **只钉已发布的 SDK**（版本见根目录 `sdk-pin.json`），方便别人 clone 就能装。不要把 `file:`、`replace` 或本地路径提交进 pin。

旁边的 `ai-bricks` 默认路径是 `../ai-bricks`。不在同一父目录时设置 `BRICKLY_HOME`。

## 日常联调：用本地 SDK

安装后把 Node SDK / UI 链到本地源码，Go 临时 `replace`，Python `uv pip install -e`。**不改**仓库里的 pin 文件。

全部工具：

```bash
npm run setup:all:local
```

单个工具（在该 Brick 目录，或把路径传给脚本）：

```bash
npm run setup -- --local
# 等价：BRICKLY_LOCAL=1 npm run setup
```

Windows 上需要本机已装 `go`、`uv`（走 `.cmd`）。找不到旁边的 `ai-bricks` 时会失败。

装完已发布版本（不链本地）：

```bash
npm run setup:all
```

## 发布后：一键升到最新 pin

SDK 发到 npm / PyPI / Go module 之后，在本仓库根目录：

```bash
npm run sync-sdk
npm run check-sdk
```

`sync-sdk` 默认读旁边 `ai-bricks` 里 `@syllm/brickly-sdk` 的版本号，改 pin、刷新 `package-lock.json` / `go.sum` / `uv.lock`。

常用参数：

```bash
npm run sync-sdk -- --version 0.9.0   # 指定版本
npm run sync-sdk -- --pins-only       # 只改 pin，不跑 lock
npm run sync-sdk -- --dry-run         # 只打印将要改的文件
```

`check-sdk` 对照 `sdk-pin.json` 检查各语言 pin 和 `protocolVersion`，并禁止 Go `replace`。

当前 pin 是 **0.9.0**，协议是 `brickly.runtime.v1`。

C++ 示例 `com.brickly.cpp-sdk-lab` 走 native + `brickly-sdk-cpp`（Go `c-shared` 绑定）。C++ SDK 尚未发版，构建必须能找到旁边的 `ai-bricks`：

```bash
node scripts/setup-brick.cjs --local com.brickly.cpp-sdk-lab
```

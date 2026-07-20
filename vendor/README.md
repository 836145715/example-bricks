# Vendor / SDK 说明

## Node：`@syllm/brickly-sdk@^0.1.2`

各 Brick `runtime/node/package.json` 统一依赖：

```json
"@syllm/brickly-sdk": "^0.1.2"
```

发布到 npm 后：

```bash
# 在各 runtime/node 下
npm install
```

包内需为 **PROTOCOL_VERSION `0.2.0`**（与当前宿主一致）。

### 本地未发 npm 时

可从 monorepo 打包再临时 `file:` 安装：

```bash
cd ../ai-bricks/Brickly/packages/brickly-sdk-node
npm run build && npm pack
# 临时： "file:../../../vendor/syllm-brickly-sdk-0.1.2.tgz"
```

### 校验

```bash
node check-node-sdk-parent.cjs
```

## Go / Python

- Go：`replace => .../brickly-sdk-go`（monorepo，BPP 0.2.0）
- Python：`requirements.txt` 中 `-e ../../ai-bricks/Brickly/packages/brickly-sdk-python`

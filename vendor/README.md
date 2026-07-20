# Vendor SDKs

本目录锁定 **与当前 Brickly 宿主协议一致** 的官方 SDK 制品。

## Node：`@syllm/brickly-sdk@0.1.2`

- 文件：`syllm-brickly-sdk-0.1.2.tgz`
- 协议：`PROTOCOL_VERSION = 0.2.0`（与宿主 `Brickly/src/main/protocol` 一致）
- 各 Brick：`runtime/node/package.json` 依赖  
  `"@syllm/brickly-sdk": "file:../../../vendor/syllm-brickly-sdk-0.1.2.tgz"`

> npm registry 上目前 latest 仍为 `0.1.1` 且内置协议仍为 `0.1.0`，**不能**用于当前宿主。  
> 发布 `@syllm/brickly-sdk@0.1.2` 到 npm 后，可将依赖改回 `^0.1.2`。

重新打包（从 ai-bricks monorepo）：

```bash
cd ../ai-bricks/Brickly/packages/brickly-sdk-node
npm run build && npm pack
cp syllm-brickly-sdk-0.1.2.tgz ../../../example-bricks/vendor/
```

## Go / Python

- Go：`go.mod` 使用 `replace => ../../../../ai-bricks/Brickly/packages/brickly-sdk-go`（源码已是 BPP 0.2.0）
- Python：`requirements.txt` 使用  
  `-e ../../ai-bricks/Brickly/packages/brickly-sdk-python`（包版本 0.1.1，BPP 0.2.0）

## 校验

```bash
node check-node-sdk-parent.cjs
```

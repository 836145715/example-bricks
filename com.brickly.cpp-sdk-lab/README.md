---
status: active
type: brick-readme
related_code:
  - manifest.json
  - runtime/cpp/main.cpp
  - runtime/cpp/build.mjs
last_verified: 2026-09-02
---

# C++ SDK 实验室

`com.brickly.cpp-sdk-lab` 是一份 **C++ native Brick**。它链接 `brickly-sdk-cpp`（内部是 `brickly-sdk-go` 的 `c-shared` DLL），用来验证 C++ 作者能 `on_command` / `start`、打日志、建资源、走 `interact`。

C++ SDK 还没有独立发版。构建必须能找到旁边的 `ai-bricks`（或 `BRICKLY_HOME`），并安装 Go + gcc/g++。

## 构建

在本目录：

```bash
npm run setup -- --local
```

或在仓库根：

```bash
node scripts/setup-brick.cjs --local com.brickly.cpp-sdk-lab
```

当前平台会得到 `runtime/<platform>/brick.exe`（或 `brick`）以及同目录的 `brickly.dll` / `libbrickly.dylib` / `libbrickly.so`。不要交叉编译：c-shared 绑定了本机 C 工具链。Windows 构建会加上 `-ldflags="-s -w"`，否则 Go 1.25 打出的 DLL 无法加载。macOS 会把 dylib 的 install name 写成 `@rpath/libbrickly.dylib`，并给入口加上 `@loader_path` rpath；宿主 cwd 是 Brick 根目录，裸文件名解析不到 sidecar。

## 命令

| 命令 | 模式 | 说明 |
| --- | --- | --- |
| `hello` | invoke | 按 `name` 返回问候，`runtime` 为 `cpp` |
| `runtime-info` | invoke | SDK 版本、协议、是否 Windows、应用名、临时目录、config |
| `make-note` | invoke | 把文本建成 Host 资源并回读 |
| `chat` | interact | 对调用方事件回 `{"type":"reply",...}` |

## 生命周期

`runtime.instance` 为 `per-call`：一次命令一个进程，没有常驻窗。

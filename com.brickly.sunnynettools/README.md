# com.brickly.sunnynettools

[qtgolang/SunnyNetTools](https://github.com/qtgolang/SunnyNetTools)（Wails + Vue3 桌面版网络抓包调试工具）的 Brickly Brick 1:1 移植。

## 架构

```
ui/                 vite 构建产物（多页面：index/Cert/ReplaceBody/Theme/debugTools/Other）
frontend/           原版 Vue3 + Element Plus + AG Grid + Monaco 前端源码
  src/wails-shim/   @wailsio/runtime 替身：
                    - Call.ByID -> control-stream session.request（UI 私有方法）
                    - 公开能力回退具名 invoke（commands-map.json）
                    - Events    -> sunnynet:<主题>；子窗走 brickly.on
                    - Dialogs   -> brickly.fs / sunnyNetFs，失败再 dialog 命令
                    - 工具窗优先 CreateBrowserWindow，失败回退 iframe 浮层
preload.cjs         体验窗补暴露 window.sunnyNetFs（pickFile / pickSavePath / pickDirectory）
runtime/go/         Go runtime
  main.go           brick SDK 接线：公开命令表 + control-stream HandleRequests；子窗 Expose control/dialog
  Service/          原版 Service 层整体移植（SunnyNet v1.4.9），仅两处适配：
                    - Config/AppList.go：Wails AppWindow -> 虚拟窗口（EmitEvent 转 brick 事件）
                    - Window.go 删除 -> windows_stub.go（多窗口注册为虚拟窗口）
```

## 开发

```bash
npm run setup            # 安装依赖并构建 UI + Go runtime
npm run dev              # 前端 vite dev（需 runtime 另行运行）
npm --prefix frontend run build   # 仅构建 UI -> ui/
cd runtime/go && go build .       # 仅构建 Go runtime
```

## 平台化（A 档）

- **公开命令**（`runtime/go/commands.go` 的 `publicCommandTable`）：抓包启停、端口/系统代理、会话读写/导入导出、断点改包、证书、进程驱动、MCP。UI 私有方法只走 `control-stream` 的 `session.request`，不再注册为 OnCommand，也没有泛型 `call` 逃生舱。
- **平台事件**：Go 侧所有事件以 `sunnynet:<原始事件名>` 发布（如 `sunnynet:updateDoneHTTP`），符合 `命名空间:主题` 规范，外部可订阅。shim 按需订阅并翻译回原事件名，原版组件零改动。
- 核心命令（启停/端口/系统代理/会话读写）带类型化 io schema，其余为 `args` 数组透传。
- **工具窗**：`open-tool-window` 声明 `command.window: standalone`，在命令内 `CreateBrowserWindow`；失败时前端回退 iframe 浮层。

## 与原版的差异

- 多窗口（证书/替换/主题/调试工具等）优先走 SDK `CreateBrowserWindow` + 子窗 `expose`；创建失败时仍回退主页面 iframe 浮层。
- 前端 `@wailsio/runtime` 全部指向本地 shim，bindings 生成的 `Call.ByID(N)` 通过构建期生成的
  `bindings-map.json` 映射回 `changeme.Service.方法名`，再经 control-stream 调用。
- 文件对话框优先 `window.brickly.fs` / `window.sunnyNetFs`，失败再走 Go 侧 `dialog` 命令。
- 剪贴板优先 SDK `Platform.Clipboard`，失败回退本机实现。
- 进程驱动抓包（NFAPI/Proxifier/Tun）依赖 SunnyNet 自带驱动，Windows 上可能需要管理员权限；
  杀软可能拦截驱动释放，需要信任。

## 杀软说明

SunnyNet 的 `netfilter2.sys` 等驱动文件常被杀软判定为 VulnDriver。本地开发需将
`C:\Users\<你>\go\pkg\mod\github.com\qtgolang\` 加入杀软信任区，否则模块解压后驱动文件会被
实时删除导致编译失败（embed 找不到文件）。

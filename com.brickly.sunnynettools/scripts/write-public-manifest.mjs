/**
 * 写出 manifest.commands。
 *
 * 公开面只留抓包生命周期、系统代理、证书、MCP 开关。
 * 主界面边角（主题/规则/get-tour 等）走 hidden interact `ui-rpc` 的 session.request，
 * 不在清单里逐条声明。数据面仍是 `capture-stream`；开子窗仍是 `open-tool-window`。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(here, "../manifest.json");

const emptyIo = {
  inputs: [],
  outputs: [{ name: "result", type: "any" }],
};

function cmd(id, zh, en, description, extra = {}) {
  const { io, ...rest } = extra;
  return {
    id,
    name: { "zh-CN": zh, en },
    description,
    io: io || emptyIo,
    ...rest,
  };
}

const publicCommands = [
  cmd("start-capture", "启动抓包代理", "Start Capture", "启动 SunnyNet 代理并开始捕获。"),
  cmd("stop-capture", "停止抓包代理", "Stop Capture", "停止代理并还原系统代理。"),
  cmd("capture-status", "抓包状态", "Capture Status", "检查代理是否正常运行。", {
    io: { inputs: [], outputs: [{ name: "running", type: "boolean" }] },
  }),
  cmd("capture-error", "最近错误", "Last Error", "获取代理最近的错误信息。", {
    io: { inputs: [], outputs: [{ name: "error", type: "string" }] },
  }),
  cmd("get-port", "读取代理端口", "Get Port", "读取当前代理端口。", {
    io: { inputs: [], outputs: [{ name: "port", type: "number" }] },
  }),
  cmd("set-port", "设置代理端口", "Set Port", "设置代理监听端口。", {
    io: { inputs: [{ name: "port", type: "number" }], outputs: [{ name: "result", type: "any" }] },
  }),
  cmd("set-system-proxy", "设置系统代理", "Set System Proxy", "把系统代理指向本工具。"),
  cmd("clear-system-proxy", "还原系统代理", "Clear System Proxy", "还原系统代理设置。"),
  cmd("export-cert", "导出证书", "Export Cert", "导出 CA 证书。", {
    io: { inputs: [{ name: "path", type: "string" }], outputs: [{ name: "ok", type: "boolean" }] },
  }),
  cmd("mcp-status", "MCP 状态", "MCP Status", "返回内置 MCP HTTP 服务状态 JSON。", {
    io: { inputs: [], outputs: [{ name: "status", type: "string" }] },
  }),
  cmd("mcp-enable", "启用 MCP", "Enable MCP", "启用内置 MCP HTTP 服务（默认 :6987）。", {
    io: {
      inputs: [{ name: "port", type: "number", required: false }],
      outputs: [{ name: "error", type: "string" }],
    },
  }),
  cmd("mcp-disable", "停用 MCP", "Disable MCP", "停用内置 MCP HTTP 服务。", {
    io: { inputs: [], outputs: [{ name: "error", type: "string" }] },
  }),
];

const runtimeCommands = [
  {
    id: "capture-stream",
    mode: "interact",
    execution: "parallel",
    hidden: true,
    name: { "zh-CN": "抓包数据流", en: "Capture Stream" },
    description:
      "interact 会话：Go 持续推送 insert/update/delete/clear/filterApplied 轻量增量；前端可 send {type:\"filter\",model} 切换过滤。",
    io: {
      inputs: [],
      outputs: [],
      inputEvents: [
        { name: "filter", type: "json" },
        { name: "clearFilter", type: "json" },
      ],
      outputEvents: [
        { name: "insert", type: "json" },
        { name: "update", type: "json" },
        { name: "delete", type: "json" },
        { name: "clear", type: "json" },
        { name: "filterApplied", type: "json" },
        { name: "socket_stream", type: "json" },
      ],
    },
  },
  {
    id: "ui-rpc",
    mode: "interact",
    execution: "parallel",
    hidden: true,
    name: { "zh-CN": "界面 RPC", en: "UI RPC" },
    description:
      "主界面边角调用（主题、规则、会话详情等）走 session.request({id,input})，不占用公开命令表。",
    io: {
      inputs: [],
      outputs: [{ name: "result", type: "any" }],
    },
  },
  {
    id: "open-tool-window",
    window: "standalone",
    hidden: true,
    name: { "zh-CN": "打开工具窗口", en: "Open Tool Window" },
    description: "CreateBrowserWindow 打开证书/改包/主题等子工具窗。须 window=standalone。",
    io: {
      inputs: [
        { name: "name", type: "string" },
        { name: "open", type: "boolean", required: false },
        { name: "args", type: "string", required: false },
      ],
      outputs: [{ name: "result", type: "json" }],
    },
  },
];

const commands = [...publicCommands, ...runtimeCommands];
const publicIds = new Set(publicCommands.map((c) => c.id));
if (commands.some((c) => c.id === "call")) {
  throw new Error("call must not be declared");
}
if (commands.filter((c) => !c.hidden).some((c) => !publicIds.has(c.id))) {
  throw new Error("visible command missing from public surface");
}
const toolWin = commands.find((c) => c.id === "open-tool-window");
if (!toolWin || toolWin.window !== "standalone" || !toolWin.hidden) {
  throw new Error("open-tool-window must be hidden standalone");
}
const uiRpc = commands.find((c) => c.id === "ui-rpc");
if (!uiRpc || uiRpc.mode !== "interact" || !uiRpc.hidden) {
  throw new Error("ui-rpc must be hidden interact");
}

const manifest = {
  $schema: "../specs/manifest.schema.json",
  manifestVersion: 1,
  id: "com.brickly.sunnynettools",
  version: "1.0.0",
  apiVersion: ">=0.1.0 <1.0.0",
  name: {
    "zh-CN": "SunnyNetTools 网络调试",
    en: "SunnyNetTools",
  },
  description: {
    "zh-CN":
      "基于 SunnyNet 的跨平台网络抓包与调试工具（qtgolang/SunnyNetTools 1:1 移植）：HTTP(S)/WebSocket/TCP/UDP 抓包、断点改包、重放、Host 映射、上游代理、证书管理、进程驱动抓包与内置工具箱。",
    en: "Cross-platform packet capture and debugging tool based on SunnyNet (1:1 port of qtgolang/SunnyNetTools).",
  },
  icon: "assets/icon.svg",
  keywords: ["capture", "proxy", "sunnynet", "http", "websocket", "debug"],
  author: "Brickly",
  preload: "preload.cjs",
  runtime: {
    type: "native",
    instance: "owned",
    entry: {
      "win-x64": "runtime/win-x64/brick.exe",
      "mac-x64": "runtime/mac-x64/brick",
      "mac-arm64": "runtime/mac-arm64/brick",
    },
  },
  subscriptions: [],
  ui: {
    type: "webview",
    entry: "ui/index.html",
    size: { width: 1280, height: 800, resizable: true },
    devTools: "debug-only",
    titleBar: "custom",
  },
  commands,
};

fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + "\n");
const visible = commands.filter((c) => !c.hidden).length;
console.log("wrote", dest, "commands", commands.length, "visible", visible);

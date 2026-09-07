/**
 * 生成 Phase 5 公开命令 manifest。由 npm/node 一次性写出，避免手改 50+ 条命令。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(here, "../manifest.json");

const genericIo = {
  inputs: [{ name: "args", type: "json" }],
  outputs: [{ name: "result", type: "any" }],
};

function cmd(id, zh, en, description, extra = {}) {
  return {
    id,
    name: { "zh-CN": zh, en },
    description,
    io: extra.io || genericIo,
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "io")),
  };
}

const commands = [
  cmd("start-capture", "启动抓包代理", "Start Capture", "启动 SunnyNet 代理并开始捕获。", {
    io: { inputs: [], outputs: [{ name: "result", type: "any" }] },
  }),
  cmd("stop-capture", "停止抓包代理", "Stop Capture", "停止代理并还原系统代理。", {
    io: { inputs: [], outputs: [] },
  }),
  cmd("capture-status", "抓包状态", "Capture Status", "检查代理是否正常运行。", {
    io: { inputs: [], outputs: [{ name: "running", type: "boolean" }] },
  }),
  cmd("capture-error", "最近错误", "Last Error", "获取代理最近的错误信息。", {
    io: { inputs: [], outputs: [{ name: "error", type: "string" }] },
  }),
  cmd("capture-version", "版本", "Version", "返回 SunnyNetTools 版本。"),
  cmd("get-port", "读取代理端口", "Get Port", "读取当前代理端口。", {
    io: { inputs: [], outputs: [{ name: "port", type: "number" }] },
  }),
  cmd("set-port", "设置代理端口", "Set Port", "设置代理监听端口。", {
    io: { inputs: [{ name: "port", type: "number" }], outputs: [] },
  }),
  cmd("is-port-set", "端口是否已设置", "Is Port Set", "检查代理端口是否已配置。"),
  cmd("set-system-proxy", "设置系统代理", "Set System Proxy", "把系统代理指向本工具。", {
    io: { inputs: [{ name: "enabled", type: "boolean" }], outputs: [] },
  }),
  cmd("clear-system-proxy", "还原系统代理", "Clear System Proxy", "还原系统代理设置。", {
    io: { inputs: [], outputs: [] },
  }),
  cmd("set-working", "设置工作状态", "Set Working", "设置抓包工作状态。"),
  cmd("goos", "操作系统", "GOOS", "返回 runtime.GOOS。"),
  cmd("get-session", "读取会话", "Get Session", "按 Theology 读取会话详情。", {
    io: {
      inputs: [{ name: "theology", type: "number" }],
      outputs: [{ name: "session", type: "json" }],
    },
  }),
  cmd("get-request-body", "读取请求体", "Get Request Body", "读取请求体；超限时返回 ResourceRef。", {
    io: {
      inputs: [
        { name: "theology", type: "number" },
        { name: "getAll", type: "boolean" },
      ],
      outputs: [{ name: "body", type: "any" }],
    },
  }),
  cmd("get-response-body", "读取响应体", "Get Response Body", "读取响应体；超限时返回 ResourceRef。", {
    io: {
      inputs: [
        { name: "theology", type: "number" },
        { name: "getAll", type: "boolean" },
      ],
      outputs: [{ name: "body", type: "any" }],
    },
  }),
  cmd("get-session-message-body", "读取会话消息体", "Get Session Message Body", "读取 TCP/WS 等会话消息体。"),
  cmd("get-all-stream", "读取流数据", "Get All Stream", "读取会话全部流数据。"),
  cmd("delete-sessions", "删除会话", "Delete Sessions", "删除指定会话。", {
    io: { inputs: [{ name: "ids", type: "json" }], outputs: [] },
  }),
  cmd("clear-sessions", "清空会话", "Clear Sessions", "清空全部会话。", {
    io: { inputs: [], outputs: [] },
  }),
  cmd("find-sessions", "查找会话", "Find Sessions", "按条件查找会话。"),
  cmd("export-sessions", "导出会话", "Export Sessions", "导出会话到文件。"),
  cmd("import-sessions", "导入会话", "Import Sessions", "从文件导入会话。", {
    io: {
      inputs: [{ name: "path", type: "string" }],
      outputs: [{ name: "result", type: "any" }],
    },
  }),
  cmd("resend-request", "重放请求", "Resend Request", "重放指定会话请求。"),
  cmd("update-note", "更新备注", "Update Note", "更新会话备注。"),
  cmd("active-send", "主动发送", "Active Send", "在会话上主动发送数据。"),
  cmd("disconnect-tcp", "断开 TCP", "Disconnect TCP", "断开指定 TCP 会话。"),
  cmd("set-break-mode", "设置断点模式", "Set Break Mode", "设置请求/响应断点。"),
  cmd("set-request-next-break-mode", "下一请求断点", "Set Next Request Break", "设置下一请求断点模式。"),
  cmd("update-http-request", "更新 HTTP 请求", "Update HTTP Request", "断点处改写 HTTP 请求。"),
  cmd("update-http-response", "更新 HTTP 响应", "Update HTTP Response", "断点处改写 HTTP 响应。"),
  cmd("export-cert", "导出证书", "Export Cert", "导出 CA 证书。"),
  cmd("list-processes", "进程列表", "List Processes", "列出可用于驱动抓包的进程。"),
  cmd("process-add-name", "添加进程名", "Add Process Name", "按进程名加入驱动抓包。"),
  cmd("process-del-name", "删除进程名", "Remove Process Name", "按进程名移出驱动抓包。"),
  cmd("process-add-pid", "添加 PID", "Add Process Pid", "按 PID 加入驱动抓包。"),
  cmd("process-del-pid", "删除 PID", "Remove Process Pid", "按 PID 移出驱动抓包。"),
  cmd("process-any", "任意进程", "Process Any", "捕获任意进程。"),
  cmd("load-device", "加载设备", "Load Device", "加载网卡/驱动设备。"),
  cmd("set-device-stop-update", "停止设备更新", "Set Device Stop Update", "停止设备列表刷新。"),
  cmd("mcp-status", "MCP 状态", "MCP Status", "返回内置 MCP 服务状态 JSON。"),
  cmd("mcp-list-ops", "MCP 操作列表", "MCP List Ops", "返回 MCP 可调用操作 JSON。"),
  cmd("mcp-enable", "启用 MCP", "Enable MCP", "启用内置 MCP 服务。"),
  cmd("mcp-disable", "停用 MCP", "Disable MCP", "停用内置 MCP 服务。"),
  cmd("dialog", "文件对话框", "File Dialog", "打开原生文件选择/保存对话框，入参 {kind: open|save|open-dir, options}。", {
    io: {
      inputs: [
        { name: "kind", type: "string" },
        { name: "options", type: "json" },
      ],
      outputs: [{ name: "path", type: "string" }],
    },
  }),
  cmd("capture-count", "抓包行数", "Capture Count", "返回当前（过滤后）会话总数。", {
    io: { inputs: [], outputs: [{ name: "total", type: "number" }] },
  }),
  cmd("capture-peek", "抓包行窗口", "Capture Peek", "按 offset/limit 读取会话行摘要窗口（Go 为唯一数据源）。", {
    io: {
      inputs: [
        { name: "offset", type: "number", required: false },
        { name: "limit", type: "number", required: false, description: "默认 100，最大 1000。" },
      ],
      outputs: [{ name: "result", type: "json", description: "{total, offset, rows[]}" }],
    },
  }),
  cmd("capture-filter", "应用抓包过滤", "Apply Capture Filter", "应用主列表过滤模型（AG 过滤模型 JSON），返回过滤后总数。", {
    io: {
      inputs: [{ name: "model", type: "json" }],
      outputs: [{ name: "total", type: "number" }],
    },
  }),
  cmd("capture-ids", "抓包行标识列表", "Capture Ids", "返回全部行的轻量标识（theology+method）。", {
    io: { inputs: [], outputs: [{ name: "rows", type: "json" }] },
  }),
  {
    id: "capture-stream",
    mode: "interact",
    execution: "parallel",
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
      ],
    },
  },
  {
    id: "control-stream",
    mode: "interact",
    execution: "parallel",
    name: { "zh-CN": "控制会话", en: "Control Stream" },
    description: {
      "zh-CN":
        "UI 支撑 RPC 双向会话：前端 session.request({op,args}) 调用内部方法（Go HandleRequests）；Go Send {__push,args} 推送主题/配置等 UI 事件。",
      en: "Bidirectional control session: session.request({op,args}) for RPC; {__push,args} events for UI pushes.",
    },
    io: {
      inputs: [],
      outputs: [],
      inputEvents: [{ name: "request", type: "json", description: "{op,args}" }],
      outputEvents: [{ name: "push", type: "json", description: "{__push,args}" }],
    },
  },
  {
    id: "open-tool-window",
    window: "standalone",
    name: { "zh-CN": "打开工具窗口", en: "Open Tool Window" },
    description:
      "在当前命令内 CreateBrowserWindow 打开证书/改包/主题/调试等子工具窗。须 window=standalone；失败时前端回退 iframe 浮层。",
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
console.log("wrote", dest, "commands", commands.length);
if (commands.some((c) => c.id === "call")) {
  throw new Error("call must not be declared");
}
if (!commands.some((c) => c.id === "open-tool-window" && c.window === "standalone")) {
  throw new Error("open-tool-window must be standalone");
}

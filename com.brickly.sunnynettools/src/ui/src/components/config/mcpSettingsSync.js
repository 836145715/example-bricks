import {Events} from "../../brickly/runtime.js";
import {McpFuncRes} from "../../brickly/api.js";

/**
 * 设置页（Main 内 Settings）监听 MCP settings 刷新。
 * @param {string} scopeKey proxy_dns | proxy_way | proxy_roles | base | https | musttcp
 * @param {(action: string, body: object) => void | Promise<void>} reloadFn
 */
export function attachMcpSettingsReload(scopeKey, reloadFn) {
  Events.On("mcp", async (evt) => {
    const mcp = evt?.data ?? {};
    const reply = (text) => {
      mcp.res = text;
      typeof McpFuncRes === "function" && McpFuncRes(mcp);
    };
    try {
      const page = String(mcp.page ?? "").toLowerCase();
      const tag = String(mcp.tag ?? "").toLowerCase();
      if (page !== "main" || tag !== "settings") {
        return;
      }
      let body = {};
      try {
        body = JSON.parse(String(mcp.msg ?? "{}"));
      } catch (_) {
        return reply("invalid payload");
      }
      const scope = String(body.scope ?? "").toLowerCase();
      const mine = String(scopeKey ?? "").toLowerCase();
      if (scope !== "" && scope !== mine) {
        return;
      }
      await reloadFn(String(body.action ?? "reload"), body);
      return reply("ok");
    } catch (e) {
      try {
        reply("处理失败");
      } catch (_) {
      }
    }
  });
}

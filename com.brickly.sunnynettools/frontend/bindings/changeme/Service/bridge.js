// Brickly 平台桥：所有绑定函数的唯一出口。
// 主窗 UI 支撑 RPC 走 control-stream 的 session.request（Go HandleRequests）。
// 子窗（brick-child）没有 start/invoke/interact，改走 expose 的 request("control")。
// 控制会话未就绪时，只允许回退 commands-map 里仍公开的具名 invoke；不再有 call 逃生舱。
import commandMap from "../../../src/wails-shim/commands-map.json";

function b() {
    try { return window.brickly || (window.parent && window.parent.brickly) || null; }
    catch { return window.brickly || null; }
}
function cache() {
    try {
        const t = window.top || window;
        return t.__sunnyRuntime || (t.__sunnyRuntime = {});
    } catch {
        return window.__sunnyRuntime || (window.__sunnyRuntime = {});
    }
}
export function isBrickChild(api = b()) {
    return !!(api && typeof api.getWindowType === "function" && api.getWindowType() === "brick-child");
}
export async function runtime() {
    const x = b();
    if (!x) return null;
    if (isBrickChild(x)) return x;
    const c = cache();
    if (c.handle) return c.handle;
    if (!c.starting) {
        c.starting = x.start().then((h) => {
            c.handle = h;
            delete c.starting;
            armExitCleanup(h);
            return h;
        })
            .catch((e) => { delete c.starting; throw e; });
    }
    return c.starting;
}

function armExitCleanup(handle) {
    const c = cache();
    if (c.exitArmed || isBrickChild()) return;
    c.exitArmed = true;
    const run = () => {
        if (c.exitRan) return;
        c.exitRan = true;
        try {
            if (handle && typeof handle.invoke === "function") {
                handle.invoke("stop-capture", {});
            }
        } catch {
            /* 关窗收尾：失败由 Go 侧钩子兜底 */
        }
    };
    window.addEventListener("pagehide", run);
    window.addEventListener("beforeunload", run);
}
export function enc(v) {
    if (v instanceof Uint8Array) {
        let s = "";
        for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
        return btoa(s);
    }
    if (v instanceof ArrayBuffer) return enc(new Uint8Array(v));
    return v;
}
export async function call(name, args = []) {
    const a = (args || []).map(enc);
    if (isBrickChild()) {
        const x = b();
        if (!x || typeof x.request !== "function") {
            throw new Error("brick-child request 不可用");
        }
        return x.request("control", { op: name, args: a });
    }
    try {
        return await controlRequest(name, args);
    } catch (e) {
        if (controlInteraction) throw e;
        const h = await runtime();
        if (!h || typeof h.invoke !== "function") throw e;
        const id = commandMap[name];
        if (id) return h.invoke(id, { args: a });
        throw e;
    }
}

/** 直接按平台命令 id 调用（不经 AppMain 方法映射）。子窗没有 invoke。 */
export async function invokeCommand(commandId, input = {}) {
    if (isBrickChild()) {
        throw new Error("brick-child 不能调用平台命令");
    }
    const h = await runtime();
    if (!h) throw new Error("window.brickly 未注入：请在 Brickly 宿主中运行");
    return h.invoke(commandId, input);
}

let controlInteraction = null;
let controlStarting = null;
const controlPushHandlers = new Set();

function resetControlSession() {
    controlInteraction = null;
    controlStarting = null;
}

function ensureControlSession() {
    if (controlInteraction) return Promise.resolve(controlInteraction);
    if (!controlStarting) {
        controlStarting = (async () => {
            const h = await runtime();
            if (!h) throw new Error("window.brickly 未注入");
            const it = await h.interact("control-stream", {}, {
                onEvent: (ev) => {
                    if (!ev || typeof ev !== "object") return;
                    if (ev.__push === undefined) return;
                    const args = Array.isArray(ev.args) ? ev.args : [];
                    for (const fn of [...controlPushHandlers]) {
                        try { fn(ev.__push, args); } catch (err) { console.warn(err); }
                    }
                }
            });
            controlInteraction = it;
            return it;
        })().catch((e) => {
            resetControlSession();
            throw e;
        });
    }
    return controlStarting;
}

async function controlRequest(op, args = [], timeoutMs = 30000) {
    const it = await ensureControlSession();
    try {
        return await it.request({ op, args: (args || []).map(enc) }, { timeoutMs });
    } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (/SESSION_CLOSED|session closed|已关闭/i.test(msg)) {
            resetControlSession();
        }
        throw e;
    }
}

/** 订阅控制会话推送（主题/配置等，替代公共事件订阅的 UI 私有通道）。 */
export function onControlPush(fn) {
    controlPushHandlers.add(fn);
    return () => controlPushHandlers.delete(fn);
}

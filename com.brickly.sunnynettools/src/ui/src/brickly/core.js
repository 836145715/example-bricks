// Brickly session + named invoke. Main window start() once; child windows request("invoke").
// 公开命令 + open-tool-window 走 handle.invoke；其余走 ui-rpc 的 session.request。

const DIRECT_INVOKE = new Set([
    "start-capture",
    "stop-capture",
    "capture-status",
    "capture-error",
    "get-port",
    "set-port",
    "set-system-proxy",
    "clear-system-proxy",
    "export-cert",
    "mcp-status",
    "mcp-enable",
    "mcp-disable",
    "open-tool-window",
]);

export function bridge() {
    try {
        return window.brickly || (window.parent && window.parent.brickly) || null;
    } catch {
        return window.brickly || null;
    }
}

export function isBrickChild(api = bridge()) {
    return !!(api && typeof api.getWindowType === "function" && api.getWindowType() === "brick-child");
}

function handleCache() {
    try {
        const top = window.top || window;
        if (!top.__sunnyRuntime) top.__sunnyRuntime = {};
        return top.__sunnyRuntime;
    } catch {
        if (!window.__sunnyRuntime) window.__sunnyRuntime = {};
        return window.__sunnyRuntime;
    }
}

function armExitCleanup(handle) {
    const c = handleCache();
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
            /* Go-side hooks still run */
        }
    };
    window.addEventListener("pagehide", run);
    window.addEventListener("beforeunload", run);
}

async function openUiRpc(handle) {
    const cache = handleCache();
    if (cache.uiRpc) return cache.uiRpc;
    if (cache.uiRpcStarting) return cache.uiRpcStarting;
    if (!handle || typeof handle.interact !== "function") {
        throw new Error("window.brickly 未注入：请在 Brickly 宿主中运行");
    }
    cache.uiRpcStarting = handle.interact("ui-rpc", {}, { onEvent() {} }).then((session) => {
        cache.uiRpc = session;
        return session;
    }).finally(() => {
        delete cache.uiRpcStarting;
    });
    return cache.uiRpcStarting;
}

function dropUiRpc(session) {
    const cache = handleCache();
    if (cache.uiRpc === session) cache.uiRpc = null;
}

function isSessionClosed(err) {
    const code = err && (err.code || err.name || "");
    const msg = err && (err.message || String(err));
    return code === "SESSION_CLOSED" || /SESSION_CLOSED/.test(msg);
}

export async function runtime() {
    const b = bridge();
    if (!b) return null;
    if (isBrickChild(b)) return b;
    const cache = handleCache();
    if (cache.handle) return cache.handle;
    if (!cache.starting) {
        cache.starting = b.start().then(async (handle) => {
            armExitCleanup(handle);
            await openUiRpc(handle);
            cache.handle = handle;
            delete cache.starting;
            return handle;
        }).catch((err) => {
            delete cache.starting;
            throw err;
        });
    }
    return cache.starting;
}

export async function ensureRuntime() {
    if (isBrickChild()) {
        const b = bridge();
        if (!b) throw new Error("window.brickly 未注入：请在 Brickly 宿主中运行");
        return b;
    }
    const handle = await runtime();
    if (!handle) throw new Error("window.brickly 未注入：请在 Brickly 宿主中运行");
    return handle;
}

export function encodeArg(v) {
    if (v instanceof Uint8Array) {
        let s = "";
        for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
        return btoa(s);
    }
    if (v instanceof ArrayBuffer) return encodeArg(new Uint8Array(v));
    if (Array.isArray(v)) return v.map(encodeArg);
    if (v && typeof v === "object") {
        const out = {};
        for (const [k, val] of Object.entries(v)) out[k] = encodeArg(val);
        return out;
    }
    return v;
}

async function requestUiRpc(handle, id, payload) {
    const session = await openUiRpc(handle);
    try {
        return await session.request({ id, input: payload });
    } catch (err) {
        if (!isSessionClosed(err)) throw err;
        dropUiRpc(session);
        const retry = await openUiRpc(handle);
        return await retry.request({ id, input: payload });
    }
}

export async function invoke(id, input) {
    const payload = input === undefined || input === null ? {} : encodeArg(input);
    if (isBrickChild()) {
        const b = bridge();
        if (!b || typeof b.request !== "function") {
            throw new Error("brick-child request 不可用");
        }
        return b.request("invoke", { id, input: payload });
    }
    const handle = await runtime();
    if (!handle || typeof handle.invoke !== "function") {
        throw new Error("window.brickly 未注入：请在 Brickly 宿主中运行");
    }
    if (DIRECT_INVOKE.has(id)) {
        return handle.invoke(id, payload);
    }
    return requestUiRpc(handle, id, payload);
}

export const invokeCommand = invoke;

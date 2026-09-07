// @wailsio/runtime 的 Brickly 替身。
// 主窗：start() 拿会话 handle；UI 私有 RPC 走 control-stream；公开命令可具名 invoke。
// 子窗 brick-child：不 start，request("control"/"dialog")，事件走 brickly.on。
// 工具窗优先 CreateBrowserWindow；失败时顶层 iframe 浮层（__win / LoadUrl）仍作回退。
import map from "./bindings-map.json";
import { call as platformCall, isBrickChild } from "../../bindings/changeme/Service/bridge.js";

export function bridge() {
    try {
        return window.brickly || (window.parent && window.parent.brickly) || null;
    } catch {
        return window.brickly || null;
    }
}

/**
 * 全局只 start 一次：UI 加载后先调用 ensureRuntime()，
 * resolve 后所有 Call.ByID / Dialogs 都复用同一个会话 handle。
 * 多个 frame / 多次调用共享同一个 Promise，不会重复 start。
 */
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

// ---- 会话 handle：懒启动，单例 ----
// window.brickly 是 contextBridge 冻结对象，不能挂属性。
// owned 策略下每个 start() 都是一个独立进程，因此 handle 统一缓存在
// 顶层窗口上（同源 iframe 可直接访问），所有 frame 共用同一个进程。

function handleCache() {
    try {
        const top = window.top || window;
        if (!top.__sunnyRuntime) top.__sunnyRuntime = {};
        return top.__sunnyRuntime;
    } catch {
        // 跨域兜底（理论上同源不会走到）
        if (!window.__sunnyRuntime) window.__sunnyRuntime = {};
        return window.__sunnyRuntime;
    }
}

async function runtime() {
    const b = bridge();
    if (!b) return null;
    if (isBrickChild(b)) return b;
    const cache = handleCache();
    if (cache.handle) return cache.handle;
    if (!cache.starting) {
        cache.starting = b.start().then((handle) => {
            cache.handle = handle;
            delete cache.starting;
            try {
                const top = window.top || window;
                const store = top.__sunnyRuntime || (top.__sunnyRuntime = {});
                if (!store.exitArmed && !isBrickChild()) {
                    store.exitArmed = true;
                    const run = () => {
                        if (store.exitRan) return;
                        store.exitRan = true;
                        try { handle.invoke("stop-capture", {}); } catch { /* ignore */ }
                    };
                    window.addEventListener("pagehide", run);
                    window.addEventListener("beforeunload", run);
                }
            } catch { /* ignore */ }
            return handle;
        }).catch((err) => {
            delete cache.starting;
            throw err;
        });
    }
    return cache.starting;
}

function encodeArg(v) {
    // Go []byte 走 JSON base64；Uint8Array/ArrayBuffer 转 base64 字符串
    if (v instanceof Uint8Array) {
        let s = "";
        for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
        return btoa(s);
    }
    if (v instanceof ArrayBuffer) return encodeArg(new Uint8Array(v));
    return v;
}

export class CancellablePromise extends Promise {}

async function invokeCall(name, args) {
    return platformCall(name, args);
}

export const Call = {
    ByID(id, ...args) {
        const name = map[String(id)];
        if (!name) return CancellablePromise.reject(new Error("unknown binding id: " + id));
        return new CancellablePromise((resolve, reject) => {
            invokeCall(name, args).then(resolve, reject);
        });
    }
};

export function invokeNamed(name, args) {
    return invokeCall(name, args);
}

export const Create = {
    Any: (v) => v,
    Array: (v) => Array.from(v ?? []),
    Map: (v) => (v instanceof Map ? Object.fromEntries(v) : v),
    Nullable: (v) => v,
    ByteSlice: encodeArg,
    Events: (v) => v,
    Result: (v) => v
};

// ---- Events ----
// Go 侧按平台规范发布 "sunnynet:<原始事件名>"；shim 按需订阅，
// 并以原始事件名分发给原版组件代码（组件零改动）。
const handlers = new Map();
const lastArgs = new Map(); // 事件名 -> 最近一次参数（供后加载的页面回放，如 LoadUrl）
const subscribedEvents = new Set();

function bindEvents(name) {
    const b = bridge();
    if (!b) return;
    const topic = "sunnynet:" + name;
    if (subscribedEvents.has(topic)) return;
    subscribedEvents.add(topic);
    const onPayload = (envelope) => {
        const payload = envelope && typeof envelope === "object" && envelope.payload !== undefined
            ? envelope.payload
            : envelope;
        if (!payload || typeof payload !== "object") return;
        dispatch(payload.name || name, payload.args || []);
    };
    if (isBrickChild(b) && typeof b.on === "function") {
        b.on(topic, onPayload);
        return;
    }
    if (!b.events) {
        subscribedEvents.delete(topic);
        return;
    }
    b.events.subscribe(topic, onPayload).catch((err) => {
        subscribedEvents.delete(topic);
        console.warn("[shim] events subscribe failed", topic, err);
    });
}

function dispatch(name, args) {
    dispatchHook(name, args);
    lastArgs.set(name, args);
    const set = handlers.get(name);
    if (!set) return;
    // 原版组件回调期望 Wails 形状：{name, data}。
    // Wails 的 EmitEvent 语义：单参数时 data = 参数本身，多参数时 data = 参数数组。
    const envelope = { name, data: args.length === 1 ? args[0] : args };
    for (const cb of [...set]) {
        try { cb(envelope); } catch (e) { console.warn("[shim] handler error", name, e); }
    }
}

export const Events = {
    On(name, cb) {
        bindEvents(name);
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name).add(cb);
        // 回放最近一次同名事件（iframe 晚于 Go 事件加载的场景）
        if (lastArgs.has(name)) {
            const args = lastArgs.get(name);
            const data = args.length === 1 ? args[0] : args;
            setTimeout(() => { try { cb({ name, data }); } catch (e) { console.warn(e); } }, 0);
        }
        return () => Events.Off(name, cb);
    },
    Off(name, cb) {
        handlers.get(name)?.delete(cb);
    },
    Emit(name, ...args) {
        dispatch(name, args);
        return Promise.resolve();
    },
    OnMultiple(name, cb) { return Events.On(name, cb); }
};

// ---- Window：映射到宿主窗口控制 ----
export const Window = {
    Close() {
        const b = bridge();
        if (isBrickChild(b) && b.window?.close) return b.window.close();
        b?.closeWindow?.();
    },
    Minimise() { bridge()?.window?.minimize?.(); },
    ToggleMaximise() { bridge()?.window?.toggleMaximize?.(); },
    Centre() {},
    SetAlwaysOnTop() {},
    SetTitle() {}
};

// ---- Dialogs：优先平台 fs 选择器；子窗走 expose dialog；否则 invoke dialog ----
function acceptFromOptions(options) {
    const f = options?.Filters || options?.filters;
    if (Array.isArray(f) && f.length) return f.join(",");
    if (typeof f === "string") return f;
    return undefined;
}

async function pickViaFs(kind, options) {
    const b = bridge();
    const fs = (typeof window !== "undefined" && window.sunnyNetFs) || b?.fs || null;
    if (!fs) return null;
    if (kind === "open-dir" && typeof fs.pickDirectory === "function") {
        const p = await fs.pickDirectory({ defaultPath: options.defaultPath || options.DefaultDirectory });
        return p ? [p] : [];
    }
    if (kind === "open" && typeof fs.pickFile === "function") {
        const p = await fs.pickFile({ accept: acceptFromOptions(options) });
        return p ? [p] : [];
    }
    if (kind === "save" && typeof fs.pickSavePath === "function") {
        const p = await fs.pickSavePath({
            defaultPath: options.defaultPath || options.DefaultFilename,
            accept: acceptFromOptions(options)
        });
        return p ? [p] : [];
    }
    return null;
}

async function fileDialog(kind, options = {}) {
    try {
        const viaFs = await pickViaFs(kind, options);
        if (viaFs) return viaFs;
    } catch (e) {
        console.warn("[shim] fs pick failed, fallback dialog", e);
    }
    const b = bridge();
    if (isBrickChild(b) && typeof b.request === "function") {
        const r = await b.request("dialog", { kind, options });
        return r && r.path ? [r.path] : [];
    }
    const handle = await runtime();
    if (!handle || typeof handle.invoke !== "function") return [];
    const r = await handle.invoke("dialog", { kind, options });
    return r && r.path ? [r.path] : [];
}
export const Dialogs = {
    OpenFile(options) { return fileDialog("open", options); },
    SaveFile(options) { return fileDialog("save", options); },
    OpenDirectory(options) { return fileDialog("open-dir", options); }
};

export const Screen = { Size: { w: window.innerWidth, h: window.innerHeight } };
export const Log = { Print: (...a) => console.log(...a) };
export const Browser = { OpenURL: (u) => window.open(u, "_blank") };
export const Clipboard = {
    ReadText: () => navigator.clipboard.readText(),
    WriteText: (t) => navigator.clipboard.writeText(t)
};

// ---- 虚拟窗口浮层 ----
const WINDOW_PAGES = {
    "Cert": "Cert.html",
    "ReplaceBody": "ReplaceBody.html",
    "主题调色": "Theme.html",
    "调试工具": "debugTools.html",
    "其他窗口": "Other.html"
};
const overlayState = { el: null, iframe: null };

function isTop() { return window.top === window; }

function ensureOverlay(page) {
    if (!isTop() || !document.body) return;
    if (!overlayState.el) {
        const el = document.createElement("div");
        el.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.35);display:none;";
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "position:absolute;inset:3%;width:94%;height:94%;border:none;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);background:#fff;";
        el.appendChild(iframe);
        document.body.appendChild(el);
        overlayState.el = el;
        overlayState.iframe = iframe;
    }
    const target = new URL(page, document.baseURI).href;
    if (!overlayState.iframe.src.endsWith(page)) overlayState.iframe.src = target;
    overlayState.el.style.display = "block";
}
function hideOverlay() {
    if (overlayState.el) overlayState.el.style.display = "none";
}

function dispatchHook(name, args) {
    if (!isTop()) return;
    if (name === "__win") {
        const [winName, action] = args || [];
        if (WINDOW_PAGES[winName]) {
            if (action === "show") ensureOverlay(WINDOW_PAGES[winName]);
            else hideOverlay();
        }
    } else if (name === "LoadUrl") {
        const [winName] = args || [];
        if (WINDOW_PAGES[winName]) ensureOverlay(WINDOW_PAGES[winName]);
    }
}

export default { Call, Create, Events, Window, Dialogs };

// Events / Dialogs / Window over window.brickly.
import { bridge, isBrickChild, runtime, invoke } from "./core.js";

const handlers = new Map();
const lastArgs = new Map();
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
        console.warn("[brickly] events subscribe failed", topic, err);
    });
}

function dispatch(name, args) {
    lastArgs.set(name, args);
    const set = handlers.get(name);
    if (!set) return;
    const envelope = { name, data: args.length === 1 ? args[0] : args };
    for (const cb of [...set]) {
        try { cb(envelope); } catch (e) { console.warn("[brickly] handler error", name, e); }
    }
}

export const Events = {
    On(name, cb) {
        bindEvents(name);
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name).add(cb);
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
        console.warn("[brickly] fs pick failed, fallback dialog", e);
    }
    const b = bridge();
    if (isBrickChild(b) && typeof b.request === "function") {
        const r = await b.request("dialog", { kind, options });
        return r && r.path ? [r.path] : [];
    }
    const r = await invoke("dialog", { kind, options });
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

export { runtime, invoke };
export default { Events, Window, Dialogs };

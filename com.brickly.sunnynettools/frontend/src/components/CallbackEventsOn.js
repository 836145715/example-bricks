import {CallTools} from "../../bindings/changeme/Service/appmain.js";
import {invokeCommand} from "../../bindings/changeme/Service/bridge.js";

export async function OpenTools(name, open, args) {
    const payload = {
        name,
        open: open === undefined || open === null ? true : open,
        args: args ?? ""
    };
    try {
        await invokeCommand("open-tool-window", payload);
    } catch {
        CallTools(name, payload.open, payload.args);
    }
}

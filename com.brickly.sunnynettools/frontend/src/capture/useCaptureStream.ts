/**
 * capture-stream（interact 会话）客户端。
 * 打开会话、接收轻量增量并转发给主列表；页面刷新自动重连。
 */
import { invokeCommand, runtime } from "../../bindings/changeme/Service/bridge.js";
import type { BricklyInteraction } from "./brickly-types";
import type { FilterModelItem, StreamDelta } from "./types";

export interface CaptureStreamHandle {
  close(): Promise<void>;
  applyFilter(model: FilterModelItem[] | null): Promise<number>;
}

function unwrapStreamEvent(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.payload && typeof obj.payload === "object") {
    return obj.payload as Record<string, unknown>;
  }
  return obj;
}

/** 打开数据流会话。onDelta 收到 {type, rows?, ids?, total?}。 */
export async function openCaptureStream(
  onDelta: (delta: StreamDelta) => void
): Promise<CaptureStreamHandle> {
  const handle = await runtime();
  if (!handle) throw new Error("window.brickly 未注入：请在 Brickly 宿主中运行");

  let interaction: BricklyInteraction | null = null;
  let closed = false;

  interaction = await handle.interact("capture-stream", {}, {
    onEvent: (raw: unknown) => {
      if (closed) return;
      const ev = unwrapStreamEvent(raw);
      if (!ev) return;
      const type = String(ev.type ?? ev.name ?? "");
      if (type === "insert" || type === "update") {
        const rows = Array.isArray(ev.rows) ? ev.rows : [];
        onDelta({ type, rows } as StreamDelta);
      } else if (type === "delete") {
        const ids = Array.isArray(ev.ids) ? ev.ids.map(Number) : [];
        onDelta({ type: "delete", ids } as StreamDelta);
      } else if (type === "clear") {
        onDelta({ type: "clear" });
      } else if (type === "filterApplied") {
        onDelta({ type: "filterApplied", total: Number(ev.total ?? 0) } as StreamDelta);
      }
    },
  });

  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await interaction?.cancel("ui closed");
    } catch {
      /* ignore */
    }
  };

  return {
    close,
    applyFilter: async (model: FilterModelItem[] | null) => {
      if (closed) return 0;
      const payload = model && model.length > 0 ? JSON.stringify(model) : "";
      await interaction?.send({ type: payload ? "filter" : "clearFilter", model: payload });
      const r = (await invokeCommand("capture-filter", { model: payload })) as { total: number };
      return Number(r?.total ?? 0);
    },
  };
}

/** 供外部判断 runtime 可用性。 */
export async function captureRuntimeReady(): Promise<boolean> {
  return (await runtime()) != null;
}

/** 数据面命令调用封装（直接走平台具名命令）。 */
import { invokeCommand } from "../brickly/core.js";
import type { FilterModelItem, PeekRequest, PeekResult } from "./types";

export async function captureCount(): Promise<number> {
  const r = (await invokeCommand("capture-count")) as { total: number };
  return Number(r?.total ?? 0);
}

export async function capturePeek(req: PeekRequest): Promise<PeekResult> {
  const r = (await invokeCommand("capture-peek", {
    offset: req.offset,
    limit: req.limit,
  })) as { total: number; offset: number; rows: PeekResult["rows"] };
  return { total: Number(r?.total ?? 0), offset: req.offset, rows: r?.rows ?? [] };
}

/** 把过滤模型 JSON 应用到 Go 侧视图。model 为 null/[] 表示清除。 */
export async function captureApplyFilter(model: FilterModelItem[] | null): Promise<number> {
  const payload = model && model.length > 0 ? model : null;
  const r = (await invokeCommand("capture-filter", {
    model: payload ? JSON.stringify(payload) : "",
  })) as { total: number };
  return Number(r?.total ?? 0);
}

<script setup lang="ts">
/**
 * 主抓包列表（Phase 1）：Tabulator 虚拟列表 + Go peek 数据面。
 * 数据不进前端全量持有：未加载区间用占位行，滚动时按窗口 capture-peek。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { TabulatorFull as Tabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator.css";
import { GetImage } from "../components/Tools/image.js";
import { captureApplyFilter, capturePeek } from "./api";
import {
  CaptureRow,
  CaptureRowOrPlaceholder,
  FilterModelItem,
  PlaceholderRow,
  isPlaceholder,
} from "./types";

const props = defineProps<{
  autoRoll: () => boolean;
  textMark?: () => Map<number, string>;
  onRowClick: (row: CaptureRow) => void;
  onSelectionChanged: (rows: CaptureRow[]) => void;
  onFilterApplied?: (total: number) => void;
  contextMenuItems?: (row: CaptureRow, selected: CaptureRow[]) => unknown[];
}>();

const rootEl = ref<HTMLDivElement>();
let table: Tabulator | null = null;

const INDEX_FIELD = "Theology";
/** TS 侧权威顺序：与 Tabulator 数据数组同构（追加序）。 */
let order: CaptureRowOrPlaceholder[] = [];
const localIds: number[] = [];
let total = 0;
let peekInFlight = false;
let peekDirty = false;
let placeholderSeq = -1;

const OVERSCAN = 40;
const PEEK_LIMIT = 300;

function makePlaceholder(): PlaceholderRow {
  placeholderSeq -= 1;
  return { Theology: placeholderSeq, __placeholder: true };
}

function rebuildPlaceholders(newTotal: number) {
  order = new Array(newTotal);
  for (let i = 0; i < newTotal; i++) order[i] = makePlaceholder();
  localIds.length = 0;
  table?.replaceData(order.slice());
}

/** 窗口内占位行补拉（只拉第一段连续占位区间）。 */
async function ensureWindow(start: number, end: number) {
  if (!table) return;
  const clampedEnd = Math.min(end, total - 1);
  let firstMissing = -1;
  let lastMissing = -1;
  for (let i = Math.max(0, start); i <= clampedEnd; i++) {
    if (i >= order.length || isPlaceholder(order[i])) {
      if (firstMissing < 0) firstMissing = i;
      lastMissing = i;
    } else if (firstMissing >= 0) {
      break;
    }
  }
  if (firstMissing < 0) return;
  const offset = firstMissing;
  const limit = Math.min(PEEK_LIMIT, lastMissing - firstMissing + 1);
  if (peekInFlight) {
    peekDirty = true;
    return;
  }
  peekInFlight = true;
  try {
    const res = await capturePeek({ offset, limit });
    total = res.total;
    const allRows = table.getRows();
    const updated: CaptureRow[] = [];
    for (let i = 0; i < res.rows.length; i++) {
      const pos = offset + i;
      if (pos >= order.length) break;
      const row = res.rows[i];
      order[pos] = row;
      updated.push(row);
    }
    // 原位替换占位行数据（不改变行数与顺序）
    for (const row of updated) {
      const pos = order.indexOf(row);
      const tr = allRows[pos];
      if (tr && isPlaceholder(tr.getData() as CaptureRowOrPlaceholder)) {
        tr.update({ ...row });
      }
    }
  } catch (e) {
    console.warn("[CaptureTable] peek failed", e);
  } finally {
    peekInFlight = false;
    if (peekDirty) {
      peekDirty = false;
      scheduleEnsureWindow();
    }
  }
}

let ensureTimer: number | null = null;
function scheduleEnsureWindow(force = false) {
  if (force) {
    // 强制模式：无视占位状态，重拉可见窗口以刷新已加载行
    const vis = getVisibleRange();
    if (vis && table) {
      void ensureWindowForce(vis.start - OVERSCAN, vis.end + OVERSCAN);
      return;
    }
  }
  if (ensureTimer !== null) return;
  ensureTimer = window.setTimeout(() => {
    ensureTimer = null;
    const vis = getVisibleRange();
    if (vis) void ensureWindow(vis.start - OVERSCAN, vis.end + OVERSCAN);
  }, 60);
}

async function ensureWindowForce(start: number, end: number) {
  if (!table) return;
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(end, total - 1);
  if (clampedEnd < clampedStart) return;
  const limit = Math.min(PEEK_LIMIT, clampedEnd - clampedStart + 1);
  try {
    const res = await capturePeek({ offset: clampedStart, limit });
    total = res.total;
    const allRows = table.getRows();
    for (let i = 0; i < res.rows.length; i++) {
      const pos = clampedStart + i;
      if (pos >= order.length) break;
      const row = res.rows[i];
      order[pos] = row;
      const tr = allRows[pos];
      if (tr) tr.update({ ...row });
    }
  } catch (e) {
    console.warn("[CaptureTable] force refresh failed", e);
  }
}

function getVisibleRange(): { start: number; end: number } | null {
  if (!table) return null;
  try {
    const rows = table.getRows("visible") as unknown as { getPosition: (v?: boolean) => number }[];
    if (!rows || rows.length === 0) return { start: 0, end: 0 };
    let start = Number.POSITIVE_INFINITY;
    let end = -1;
    for (const r of rows) {
      const pos = r.getPosition(true) - 1;
      if (pos < start) start = pos;
      if (pos > end) end = pos;
    }
    return { start, end };
  } catch {
    return null;
  }
}

// ---- 过滤模型（Tabulator headerFilter → ListSearch JSON） ----
const FILTERABLE: Record<string, string> = {
  方式: "方式",
  状态: "状态码",
  主机名: "主机名",
  路径: "Path",
  请求地址: "请求地址",
  响应类型: "响应类型",
  进程: "进程",
  注释: "注释",
  来源地址: "来源地址",
  响应IP: "响应IP",
  身份验证账号: "身份验证账号",
  参数: "参数",
  请求时间: "请求时间",
  响应时间: "响应时间",
};

function collectFilterModel(): FilterModelItem[] {
  const model: FilterModelItem[] = [];
  if (!table) return model;
  for (const col of table.getColumns()) {
    const def = col.getDefinition() as { title?: string };
    const key = FILTERABLE[def.title ?? ""];
    if (!key) continue;
    const value = col.getHeaderFilterValue();
    if (value === undefined || value === null || String(value).trim() === "") continue;
    model.push({ filterType: "text", colId: key, type: "contains", filter: String(value).trim() });
  }
  return model;
}

async function applyHeaderFilters() {
  if (!table) return;
  const conditions = collectFilterModel();
  let model: unknown;
  if (conditions.length === 0) {
    model = [];
  } else if (conditions.length === 1) {
    model = conditions[0];
  } else {
    model = { filterType: "join", type: "AND", conditions };
  }
  const newTotal = await captureApplyFilter(conditions.length === 0 ? [] : [model as FilterModelItem]);
  total = newTotal;
  rebuildPlaceholders(total);
  scheduleEnsureWindow();
  props.onFilterApplied?.(total);
}

// ---- 列定义（与原版 17 列对齐） ----
function seqFormatter(cell: {
  getValue: () => unknown;
  getRow: () => { getData: () => CaptureRowOrPlaceholder };
}): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "cursor:pointer;display:flex;align-items:center;gap:4px;";
  const data = cell.getRow().getData();
  const img = document.createElement("img");
  img.style.cssText = "height:22px;width:22px;";
  if (!isPlaceholder(data)) {
    const mode = Number((data as CaptureRow)["断点模式"] ?? 0);
    img.src =
      mode === 1
        ? GetImage("拦截上行")
        : mode === 2
          ? GetImage("拦截下行")
          : GetImage((data as CaptureRow).ico || "空白");
  } else {
    img.src = GetImage("空白");
  }
  el.appendChild(img);
  const text = document.createElement("span");
  text.textContent = String(cell.getValue() ?? "");
  el.appendChild(text);
  return el;
}

function buildColumns() {
  const t = (title: string, field: string, extra: Record<string, unknown> = {}) => ({
    title,
    field,
    headerFilter: "input" as const,
    ...extra,
  });
  return [
    { title: "序号", field: "序号", width: 110, frozen: true, formatter: seqFormatter },
    { title: "Theology", field: "Theology", visible: false },
    t("方式", "方式", { width: 90 }),
    t("状态", "状态", { width: 100 }),
    t("主机名", "主机名", { visible: false }),
    t("路径", "路径", { visible: false }),
    t("请求地址", "请求地址", { width: 260 }),
    t("响应长度", "响应长度", { width: 110 }),
    t("响应类型", "响应类型", { visible: false }),
    t("进程", "进程", { width: 120 }),
    t("注释", "注释", { width: 120, editor: "input" }),
    t("请求时间", "请求时间", { visible: false }),
    t("响应时间", "响应时间", { visible: false }),
    t("来源地址", "来源地址", { width: 140 }),
    t("响应IP", "响应IP", { width: 140 }),
    t("身份验证账号", "身份验证账号", { visible: false }),
    t("参数", "参数", { visible: false }),
  ] as never;
}

// ---- 增量入口（由 useCaptureStream 调用） ----
function onInsertDelta(ids: number[]) {
  if (ids.length === 0) return;
  total += ids.length;
  const placeholders: PlaceholderRow[] = [];
  for (const id of ids) {
    localIds.push(id);
    const p = makePlaceholder();
    order.push(p);
    placeholders.push(p);
  }
  table?.addData(placeholders, false);
  if (props.autoRoll()) {
    try {
      const rows = table?.getRows();
      const last = rows?.[rows.length - 1];
      if (last) void table?.scrollToRow(last, "bottom", false);
    } catch {
      /* ignore */
    }
  }
  scheduleEnsureWindow();
}

function onUpdateDelta(ids: number[]) {
  const set = new Set(ids.map(Number));
  let touched = false;
  for (const data of order) {
    if (!isPlaceholder(data) && set.has(Number(data.Theology))) touched = true;
  }
  if (!touched) return;
  // 可见区间内的行重拉窗口刷新；不可见行保持占位（滚动到时自然拉到新数据）
  scheduleEnsureWindow(true);
}

function onDeleteDelta(ids: number[]) {
  const set = new Set(ids.map(Number));
  const allRows = table?.getRows() ?? [];
  const toDelete: number[] = [];
  for (const tr of allRows) {
    const data = tr.getData() as CaptureRowOrPlaceholder;
    if (!isPlaceholder(data) && set.has(Number(data.Theology))) toDelete.push(Number(data.Theology));
  }
  if (toDelete.length === 0) return;
  table?.deleteRow(toDelete);
  for (const id of toDelete) {
    const pos = localIds.indexOf(id);
    if (pos >= 0) {
      localIds.splice(pos, 1);
      order.splice(pos, 1);
    }
  }
  scheduleEnsureWindow();
}

function onClearDelta() {
  localIds.length = 0;
  order = [];
  table?.clearData();
  void refreshAll();
}

function onFilterAppliedDelta(t: number) {
  total = t;
  rebuildPlaceholders(t);
  scheduleEnsureWindow();
  props.onFilterApplied?.(t);
}

export type StreamDeltaIn = { type: string; ids?: number[]; total?: number };

function applyDelta(delta: StreamDeltaIn) {
  switch (delta.type) {
    case "insert":
      onInsertDelta(delta.ids ?? []);
      break;
    case "update":
      onUpdateDelta(delta.ids ?? []);
      break;
    case "delete":
      onDeleteDelta(delta.ids ?? []);
      break;
    case "clear":
      onClearDelta();
      break;
    case "filterApplied":
      onFilterAppliedDelta(Number(delta.total ?? 0));
      break;
  }
}

async function refreshAll() {
  if (!table) return;
  const res = await capturePeek({ offset: 0, limit: 1 });
  total = Math.max(res.total, 0);
  rebuildPlaceholders(total);
  scheduleEnsureWindow();
}

function getSelectedRowsLocal(): CaptureRow[] {
  const rows = (table?.getSelectedRows?.() ?? []) as { getData: () => CaptureRowOrPlaceholder }[];
  return rows.map((r) => r.getData()).filter((d): d is CaptureRow => !isPlaceholder(d));
}

defineExpose({
  applyDelta,
  refreshAll,
  refreshVisible: () => scheduleEnsureWindow(true),
  applyHeaderFilters: () => applyHeaderFilters(),
  clearHeaderFilters: () => {
    if (!table) return;
    for (const col of table.getColumns()) {
      const def = col.getDefinition() as { headerFilter?: unknown };
      if (def.headerFilter) col.setHeaderFilterValue("");
    }
  },
  getSelectedRows: getSelectedRowsLocal,
  getTable: () => table,
});

// ---- 生命周期 ----
onMounted(() => {
  if (!rootEl.value) return;
  table = new Tabulator(rootEl.value, {
    index: INDEX_FIELD,
    data: [],
    columns: buildColumns(),
    layout: "fitColumns",
    height: "100%",
    placeholder: "还没有捕获到数据",
    selectableRows: true,
    rowFormatter: (row: { getElement: () => HTMLElement; getData: () => CaptureRowOrPlaceholder }) => {
      const data = row.getData();
      if (isPlaceholder(data)) return;
      const el = row.getElement();
      if (data.color) el.style.color = data.color;
      const mark = props.textMark?.().get(Number((data as CaptureRow).Theology));
      if (mark) el.style.color = mark;
    },
    rowContext: (_e: Event, row: { getData: () => CaptureRowOrPlaceholder }) => {
      const data = row.getData();
      if (isPlaceholder(data) || !props.contextMenuItems) return false;
      const menu = props.contextMenuItems(data as CaptureRow, getSelectedRowsLocal());
      if (!Array.isArray(menu)) return false;
      return menu as never;
    },
    rowClick: (_e: Event, row: { getData: () => CaptureRowOrPlaceholder }) => {
      const data = row.getData();
      if (isPlaceholder(data)) return;
      props.onRowClick(data as CaptureRow);
    },
    rowSelectionChanged: (_data: unknown, rows: { getData: () => CaptureRowOrPlaceholder }[]) => {
      const list = rows
        .map((r) => r.getData())
        .filter((d): d is CaptureRow => !isPlaceholder(d));
      props.onSelectionChanged(list);
    },
    headerFilterChanged: () => {
      void applyHeaderFilters();
    },
    renderComplete: () => scheduleEnsureWindow(),
  });
  void refreshAll();
  rootEl.value.addEventListener("scroll", () => scheduleEnsureWindow(), { passive: true });
});

onBeforeUnmount(() => {
  table?.destroy();
  table = null;
});

// ---- 深/浅主题跟随 ----
const isDark = ref(document.documentElement.classList.contains("dark"));
const classObserver = new MutationObserver(() => {
  isDark.value = document.documentElement.classList.contains("dark");
});
classObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
watch(
  isDark,
  (v) => {
    rootEl.value?.classList.toggle("tabulator--dark", v);
    rootEl.value?.classList.toggle("tabulator--light", !v);
  },
  { immediate: true }
);
onBeforeUnmount(() => classObserver.disconnect());
</script>

<template>
  <div ref="rootEl" class="capture-table" style="height: 100%; width: 100%"></div>
</template>

<style src="./capture-theme.css"></style>

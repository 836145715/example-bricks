/**
 * 数据面（Phase 1）类型定义。
 * Go 为唯一数据源：capture-peek 拉行窗口，capture-stream 推轻量增量。
 */

/** 主列表行摘要（中文键，与原版行对象一致；Go CaptureSummary 派生）。 */
export interface CaptureRow {
  Theology: number
  序号: number
  方式: string
  请求地址: string
  主机名: string
  路径: string
  状态: string
  注释: string
  身份验证账号: string
  参数: string
  进程: string
  来源地址: string
  请求时间: string
  响应长度: string | number
  响应类型?: string
  响应时间?: string
  响应IP: string
  ico: string
  断点模式: number
  color: string
  Filter: boolean
  GuaranteeDisplay?: boolean
}

/** 未加载的占位行。 */
export interface PlaceholderRow {
  Theology: number
  __placeholder: true
}

export type CaptureRowOrPlaceholder = CaptureRow | PlaceholderRow

export function isPlaceholder(row: CaptureRowOrPlaceholder): row is PlaceholderRow {
  return (row as PlaceholderRow).__placeholder === true
}

export interface PeekRequest {
  offset: number
  limit: number
}

export interface PeekResult {
  total: number
  offset: number
  rows: CaptureRow[]
}

/** capture-stream（interact）下行增量。insert/update 携带行摘要（已含全部列表字段）。 */
export type StreamDelta =
  | { type: 'insert'; rows: CaptureRow[] }
  | { type: 'update'; rows: CaptureRow[] }
  | { type: 'delete'; ids: number[] }
  | { type: 'clear' }
  | { type: 'filterApplied'; total: number }
  | { type: 'socket_stream'; rows: unknown[] }

/** capture-stream 上行控制。 */
export type StreamControl =
  | { type: 'filter'; model: unknown }
  | { type: 'clearFilter' }

/** AG Grid 兼容的过滤模型（ListSearch 输入）。 */
export interface FilterModelItem {
  filterType: string
  type: string
  filter?: string | number
  filterTo?: string | number
  colId?: string
}

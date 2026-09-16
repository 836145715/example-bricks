/**
 * 磁盘地图 - 类型定义（与 Go runtime 的 JSON 契约一一对应）
 */

export type NodeKind = 'dir' | 'file' | 'link' | 'other'

export interface NodeFlags {
  kind: NodeKind
  protected: boolean
  inaccessible: boolean
  dataless: boolean
  mount: boolean
}

export interface NodeSummary {
  path: string
  name: string
  allocatedBytes: number
  logicalBytes: number
  fileCount: number
  dirCount: number
  childCount?: number
  complete: boolean
  flags: NodeFlags
}

export interface TreeNode extends NodeSummary {
  children: NodeSummary[]
}

export interface ProgressEvent {
  root: string
  scannedFiles: number
  scannedBytes: number
  currentPath: string
}

export interface DoneEvent {
  root: string
  scannedFiles: number
  scannedBytes: number
}

export type ScanEvent =
  | { type: 'progress'; progress: ProgressEvent }
  | { type: 'node'; node: NodeSummary }
  | { type: 'done'; done: DoneEvent }

export interface ScanResult {
  completed: boolean
  root: string
  scannedFiles: number
  scannedBytes: number
}

export interface PeekResult {
  root: string
  node: TreeNode
}

export interface VolumeInfo {
  path: string
  device: string
  totalBytes: number
  freeBytes: number
  availableBytes: number
  purgeableBytes: number | null
  snapshots: string[]
  snapshotsError?: string
}

export interface RecipeItem {
  id: string
  label: string
  path: string
  kind: 'dir' | 'file'
  exists: boolean
  bytes: number | null
  inRoot: boolean
}

export interface TrashItemResult {
  path: string
  ok: boolean
  error?: string
}

export interface TrashResult {
  results: TrashItemResult[]
  trashedCount: number
  failedCount: number
}

export interface ExtStat {
  ext: string
  bytes: number
  files: number
}

export interface ExtStatsResult {
  root: string
  items: ExtStat[]
}

export type ChartView = 'pie' | 'treemap'

/** 暂存箱条目 */
export interface TrayItem {
  path: string
  name: string
  allocatedBytes: number
  kind: NodeKind
}

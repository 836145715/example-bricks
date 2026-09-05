import { formatShare, nodeFill } from './format.ts'
import type { NodeSummary, TreeNode } from './types.ts'

export interface ChartNode {
  name: string
  value: number
  color: string
  summary: NodeSummary
  isFree?: boolean
  children?: ChartNode[]
  label?: string
}

/** 饼图引线标签：低于此占比不画字，避免 top-64 挤成一团。 */
export const PIE_LABEL_MIN_SHARE = 0.01

/** G2 outside/spider 的 connectorLength 默认等于 offset（0），不写长度就看不见线。 */
export const PIE_LABEL_CONNECTOR = {
  connectorLength: 16,
  connectorLength2: 24,
  connectorDistance: 4
}

function asLeaf(summary: NodeSummary, ring: 1 | 2): ChartNode {
  return {
    name: summary.name,
    value: Math.max(0, summary.allocatedBytes),
    color: nodeFill(summary, ring),
    summary
  }
}

function layerChildren(node: TreeNode | undefined, ring: 1 | 2, skipOther: boolean): ChartNode[] {
  if (!node) return []
  return node.children
    .filter((child) => child.flags.kind !== 'link' && child.allocatedBytes > 0)
    .filter((child) => !(skipOther && child.flags.kind === 'other'))
    .map((child) => asLeaf(child, ring))
}

export function pieSliceTotal(slices: ChartNode[]): number {
  return slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)
}

export function pieLabelText(slice: ChartNode, slices: ChartNode[]): string {
  const total = pieSliceTotal(slices)
  if (total <= 0 || slice.value <= 0) return ''
  if (slice.value / total < PIE_LABEL_MIN_SHARE) return ''
  return `${slice.name} ${formatShare(slice.value, total)}`
}

/** 当前层扁平扇区：只含这个目录的孩子，不把卷可用空间画进饼里。 */
export function toPieData(node: TreeNode): ChartNode[] {
  const kids = layerChildren(node, 1, false)
  return kids.map((slice) => ({ ...slice, label: pieLabelText(slice, kids) }))
}

/** 图层指纹：孩子大小变了才重绘，避免选中时新对象把双击第二下打丢。 */
export function chartLayerKey(node: TreeNode | undefined): string {
  if (!node) return ''
  const kids = node.children
    .filter((child) => child.flags.kind !== 'link' && child.allocatedBytes > 0)
    .map((child) => `${child.path}:${child.allocatedBytes}`)
    .join('|')
  return `${node.path}:${node.allocatedBytes}:${node.complete}:${kids}`
}

/** 矩阵树图只画当前层叶子；下钻靠 peek，不在选中时改树以免整图重建。 */
export function toTreemapData(node: TreeNode): ChartNode {
  return {
    name: node.name,
    value: node.allocatedBytes,
    color: nodeFill(node, 1),
    summary: node,
    children: layerChildren(node, 1, false)
  }
}

export function unwrapChartNode(payload: unknown): ChartNode | undefined {
  const queue: unknown[] = [payload]
  const seen = new Set<unknown>()
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    const rec = current as Record<string, unknown>
    if (rec.summary && typeof rec.name === 'string') return rec as unknown as ChartNode
    for (const key of ['data', '__data__', 'datum']) {
      if (rec[key] !== undefined) queue.push(rec[key])
    }
  }
  return undefined
}

/** 从 G2 element:click / tooltip 事件里取出原始数据。getDataByXY 在非柱状图上命中不可靠，不用。 */
export function nodeFromChartEvent(ev: unknown): ChartNode | undefined {
  return unwrapChartNode(ev)
}

/** 图表选中判定：只有带 path 的节点能被选中（other 聚合行 path 为空，永远不算选中）。 */
export function isChartNodeSelected(node: ChartNode | undefined, selectedPath: string | null): boolean {
  const path = node?.summary.path
  return Boolean(selectedPath && path && path === selectedPath)
}

/**
 * 图表点击语义（饼图/树图共用）：目录下钻、文件选中。
 * other 聚合行与空白处不做任何事（与列表 rowClick 一致）；isFree 楔块清除选中。
 */
export function actOnChartNode(
  node: ChartNode | undefined,
  onSelect: (path: string | null) => void,
  onDrill: (path: string) => void
): void {
  if (!node || node.isFree) {
    onSelect(null)
    return
  }
  if (node.summary.flags.kind === 'other') return
  if (node.summary.flags.kind === 'dir' && node.summary.path) {
    onDrill(node.summary.path)
    return
  }
  onSelect(node.summary.path || null)
}

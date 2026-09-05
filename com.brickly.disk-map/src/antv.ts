import { Runtime, corelib, extend, graphlib } from '@antv/g2'

import { unwrapChartNode, type ChartNode } from './chart-data.ts'

/** 只用 core + 层级图（矩阵树图），饼图走 interval+theta，不打 G2 plot 扩展。 */
export const Chart = extend(Runtime, { ...corelib(), ...graphlib() })

export type G2Chart = InstanceType<typeof Chart>

/** 暗底上默认 active stroke 是黑的；树图默认还把 hovered 做成 opacity 0.6。都盖掉。 */
export const CHART_HIGHLIGHT = {
  elementHighlight: { background: false, delay: 0 },
  tooltip: true
}

export const CHART_HIGHLIGHT_STATE = {
  active: {
    stroke: '#0a84ff',
    lineWidth: 2.5,
    fillOpacity: 1,
    opacity: 1,
    shadowColor: 'rgba(10, 132, 255, 0.45)',
    shadowBlur: 10
  },
  inactive: { fillOpacity: 0.38, opacity: 0.38 }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function pointerOffset(event: MouseEvent, host: HTMLElement): { x: number; y: number } {
  const canvas = host.querySelector('canvas')
  const rect = (canvas ?? host).getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

export function nodeFromPointer(chart: G2Chart, event: MouseEvent, host: HTMLElement): ChartNode | undefined {
  const { x, y } = pointerOffset(event, host)
  const hits = chart.getDataByXY({ x, y }) ?? []
  for (const hit of hits) {
    const node = unwrapChartNode(hit)
    if (node) return node
  }
  return undefined
}

export function nodeFromChartEvent(chart: G2Chart, ev: unknown): ChartNode | undefined {
  const rec = ev as {
    data?: unknown
    nativeEvent?: MouseEvent
    gEvent?: { nativeEvent?: MouseEvent; target?: { __data__?: unknown } }
    target?: { __data__?: unknown }
  }
  const direct =
    unwrapChartNode(rec?.data) ??
    unwrapChartNode(rec?.target?.__data__) ??
    unwrapChartNode(rec?.gEvent?.target?.__data__)
  if (direct) return direct

  const native = rec?.gEvent?.nativeEvent ?? rec?.nativeEvent
  const x = native?.offsetX
  const y = native?.offsetY
  if (typeof x === 'number' && typeof y === 'number') {
    const hits = chart.getDataByXY({ x, y }) ?? []
    for (const hit of hits) {
      const node = unwrapChartNode(hit)
      if (node) return node
    }
  }
  return unwrapChartNode(ev)
}

export function fillOf(datum: unknown): string {
  const node = unwrapChartNode(datum)
  if (node?.isFree) return 'rgba(255,255,255,0.05)'
  return node?.color ?? 'hsl(170 10% 30%)'
}

export function isSelectedDatum(datum: unknown, selectedPath: string | null): boolean {
  if (!selectedPath) return false
  const path = unwrapChartNode(datum)?.summary.path
  return Boolean(path && (path === selectedPath || selectedPath.startsWith(path + '/')))
}

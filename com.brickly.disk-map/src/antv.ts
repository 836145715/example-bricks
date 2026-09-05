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

/** 从 G2 element:click / tooltip 事件里取出原始数据。getDataByXY 在非柱状图上命中不可靠，不用。 */
export function nodeFromChartEvent(ev: unknown): ChartNode | undefined {
  return unwrapChartNode(ev)
}

export function fillOf(datum: unknown): string {
  const node = unwrapChartNode(datum)
  if (node?.isFree) return 'rgba(255,255,255,0.05)'
  return node?.color ?? 'hsl(170 10% 30%)'
}

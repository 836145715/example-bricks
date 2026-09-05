import { useEffect, useRef } from 'react'

import { Chart, nodeFromChartEvent, nodeFromPointer, type G2Chart } from '../antv'
import type { ChartNode } from '../chart-data'

interface ChartHandlers {
  onClick?: (ev: unknown, chart: G2Chart) => void
}

interface ChartHostOptions {
  padding?: number
  /** 只有图层数据真变了才 options+render，避免选中/重渲染把双击拆开。 */
  dataKey?: string
}

/** 单击直接触发：目录下钻 / 文件选中，不再区分双击。 */
export const CHART_SELECT_DELAY_MS = 0

function syntheticEvent(node: ChartNode | undefined): { data: { data: unknown } } {
  return { data: { data: node } }
}

/** 图实例跟容器走；spec 变了只 options+render，不销毁，否则双击第二下打在新画布上。 */
export function useG2Chart(
  spec: Record<string, unknown> | null,
  handlers: ChartHandlers = {},
  host: ChartHostOptions = {}
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<G2Chart | null>(null)
  const specRef = useRef(spec)
  specRef.current = spec
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const lastHitRef = useRef<ChartNode | undefined>(undefined)
  const padding = host.padding ?? 8
  const dataKey = host.dataKey ?? ''

  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      padding,
      theme: 'classicDark'
    })
    chartRef.current = chart

    let selectTimer: number | null = null

    const hitOf = (event: MouseEvent): ChartNode | undefined => {
      const node = nodeFromPointer(chart, event, el) ?? nodeFromChartEvent(chart, event)
      if (node) lastHitRef.current = node
      return node ?? lastHitRef.current
    }

    const onPointerMove = (event: PointerEvent) => {
      hitOf(event as unknown as MouseEvent)
    }

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      const node = hitOf(event)
      if (selectTimer !== null) window.clearTimeout(selectTimer)
      selectTimer = window.setTimeout(() => {
        selectTimer = null
        handlersRef.current.onClick?.(syntheticEvent(node), chart)
      }, CHART_SELECT_DELAY_MS)
    }

    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('click', onClick)

    return () => {
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('click', onClick)
      if (selectTimer !== null) window.clearTimeout(selectTimer)
      chart.off()
      chart.destroy()
      chartRef.current = null
    }
  }, [padding])

  useEffect(() => {
    const chart = chartRef.current
    const next = specRef.current
    if (!chart || !next) return
    lastHitRef.current = undefined
    chart.options(next as never)
    void chart.render()
  }, [dataKey])

  return { hostRef, chartRef }
}

import { useEffect, useRef } from 'react'

import { Chart, nodeFromChartEvent, nodeFromPointer, type G2Chart } from '../antv'
import type { ChartNode } from '../chart-data'

interface ChartHandlers {
  onClick?: (ev: unknown, chart: G2Chart) => void
  onDblClick?: (ev: unknown, chart: G2Chart) => void
}

interface ChartHostOptions {
  padding?: number
  /** 只有图层数据真变了才 options+render，避免选中/重渲染把双击拆开。 */
  dataKey?: string
}

/** 单击选中要等这一窗，避免第一下就把图画毁导致双击进不去。 */
export const CHART_SELECT_DELAY_MS = 280

const DRILL_LOCK_MS = 400

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
    let drilled = false
    let lastDrillAt = 0

    const hitOf = (event: MouseEvent): ChartNode | undefined => {
      const node = nodeFromPointer(chart, event, el) ?? nodeFromChartEvent(chart, event)
      if (node) lastHitRef.current = node
      return node ?? lastHitRef.current
    }

    const fireDrill = (event: MouseEvent) => {
      const now = Date.now()
      if (now - lastDrillAt < DRILL_LOCK_MS) return
      const node = hitOf(event)
      if (!node) return
      lastDrillAt = now
      drilled = true
      if (selectTimer !== null) {
        window.clearTimeout(selectTimer)
        selectTimer = null
      }
      handlersRef.current.onDblClick?.(syntheticEvent(node), chart)
    }

    const onPointerMove = (event: PointerEvent) => {
      hitOf(event as unknown as MouseEvent)
    }

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (event.detail >= 2) {
        fireDrill(event)
        return
      }
      drilled = false
      const node = hitOf(event)
      if (selectTimer !== null) window.clearTimeout(selectTimer)
      selectTimer = window.setTimeout(() => {
        selectTimer = null
        if (drilled) return
        handlersRef.current.onClick?.(syntheticEvent(node), chart)
      }, CHART_SELECT_DELAY_MS)
    }

    const onDblClick = (event: MouseEvent) => {
      event.preventDefault()
      fireDrill(event)
    }

    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('click', onClick)
    el.addEventListener('dblclick', onDblClick)

    return () => {
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('click', onClick)
      el.removeEventListener('dblclick', onDblClick)
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

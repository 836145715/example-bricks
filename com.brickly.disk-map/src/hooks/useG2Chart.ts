import { useEffect, useRef } from 'react'

import { Chart, type G2Chart } from '../antv'
import { nodeFromChartEvent, type ChartNode } from '../chart-data'

interface ChartHandlers {
  onClick?: (node: ChartNode | undefined, chart: G2Chart) => void
}

interface ChartHostOptions {
  padding?: number
  /** 只有图层数据真变了才 options+render，避免选中/重渲染把点击打丢。 */
  dataKey?: string
  /**
   * 选中态变化时也 options+render（只改样式回调，不重建图层）。
   * 单击模型下安全：点击事件已在 setState 前触发，不存在双击被拆开的问题。
   */
  selectionKey?: string
}

/** 图实例跟容器走；spec 变了只 options+render，不销毁。 */
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
  const padding = host.padding ?? 8
  const dataKey = host.dataKey ?? ''
  const selectionKey = host.selectionKey ?? ''

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

    // G2 内置 event interaction 会转发 element:click，事件自带命中数据（data.data），
    // 不依赖 getDataByXY（它在非柱状图上总是命中最后一个元素）。
    const onElementClick = (ev: unknown) => {
      handlersRef.current.onClick?.(nodeFromChartEvent(ev), chart)
    }
    chart.on('element:click', onElementClick)

    return () => {
      chart.off('element:click', onElementClick)
      chart.off()
      chart.destroy()
      chartRef.current = null
    }
  }, [padding])

  useEffect(() => {
    const chart = chartRef.current
    const next = specRef.current
    if (!chart || !next) return
    chart.options(next as never)
    void chart.render()
  }, [dataKey, selectionKey])

  return { hostRef, chartRef }
}

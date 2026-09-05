import React, { useMemo } from 'react'

import { CHART_HIGHLIGHT, CHART_HIGHLIGHT_STATE, fillOf } from '../antv'
import { chartLayerKey, toTreemapData, unwrapChartNode, type ChartNode } from '../chart-data'
import { formatBytes, formatShare } from '../format'
import { useG2Chart } from '../hooks/useG2Chart'
import type { TreeNode } from '../types'

interface TreemapProps {
  node: TreeNode | undefined
  selectedPath: string | null
  selectedNode: TreeNode | undefined
  scanning: boolean
  onSelect: (path: string | null) => void
  onDrill: (path: string) => void
}

function act(node: ChartNode | undefined, onSelect: (path: string | null) => void, onDrill: (path: string) => void) {
  if (!node || node.isFree) {
    onSelect(null)
    return
  }
  if (node.summary.flags.kind === 'dir' && node.summary.path) {
    onDrill(node.summary.path)
    return
  }
  onSelect(node.summary.path || null)
}

/** AntV G2 矩阵树图：只画当前层叶子，下钻走 peek。 */
export const Treemap: React.FC<TreemapProps> = ({
  node,
  scanning,
  onSelect,
  onDrill
}) => {
  const spec = useMemo(() => {
    if (!node) return null
    const data = toTreemapData(node)
    const denom = Math.max(node.allocatedBytes, 1)
    return {
      type: 'treemap',
      data: { value: data },
      layout: {
        tile: 'treemapSquarify',
        paddingInner: 2
      },
      encode: {
        value: 'value',
        color: (d: { data?: ChartNode; color?: string }) => d.data?.color ?? d.color ?? fillOf(d)
      },
      legend: false,
      axis: false,
      scale: { color: { type: 'identity' } },
      interaction: { ...CHART_HIGHLIGHT, treemapDrillDown: false },
      state: CHART_HIGHLIGHT_STATE,
      animate: false,
      style: {
        viewFill: 'transparent',
        fill: (d: unknown) => fillOf(d),
        fillOpacity: 1,
        stroke: '#070b11',
        lineWidth: 1.2,
        labelText: (d: unknown) => {
          const n = unwrapChartNode(d)
          if (!n) return ''
          return `${n.name}\n${formatBytes(n.summary.allocatedBytes)} ${formatShare(n.summary.allocatedBytes, denom)}`
        },
        labelFill: '#b7c9c4',
        labelPosition: 'top-left',
        labelDx: 4,
        labelDy: 4,
        labelFontSize: 11,
        labelFontWeight: 600,
        labelPointerEvents: 'none',
        cursor: 'pointer'
      },
      tooltip: {
        title: (d: unknown) => unwrapChartNode(d)?.name ?? '',
        items: [
          (d: unknown) => {
            const n = unwrapChartNode(d)
            return { name: '占用', value: formatBytes(n?.summary.allocatedBytes ?? 0) }
          }
        ]
      }
    }
  }, [node])

  const { hostRef } = useG2Chart(
    spec,
    {
      onClick: (node) => act(node, onSelect, onDrill)
    },
    { dataKey: chartLayerKey(node) }
  )

  return (
    <div className={`treemap-wrap ${scanning ? 'is-scanning' : ''}`}>
      <div ref={hostRef} className="g2-host" role="img" aria-label="目录占用矩阵树图" />
    </div>
  )
}

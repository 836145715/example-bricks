import React, { useMemo } from 'react'

import { CHART_HIGHLIGHT, CHART_HIGHLIGHT_STATE, fillOf, nodeFromChartEvent, type G2Chart } from '../antv'
import { PIE_LABEL_CONNECTOR, chartLayerKey, pieSliceTotal, toPieData, unwrapChartNode, type ChartNode } from '../chart-data'
import { formatBytes, formatShare } from '../format'
import { useG2Chart } from '../hooks/useG2Chart'
import type { TreeNode, VolumeInfo } from '../types'

interface PieProps {
  node: TreeNode | undefined
  volume: VolumeInfo | null
  selectedPath: string | null
  scanning: boolean
  canGoUp: boolean
  onSelect: (path: string | null) => void
  onDrill: (path: string) => void
  onGoUp: () => void
}

function act(node: ChartNode | undefined, mode: 'select' | 'drill', onSelect: (path: string | null) => void, onDrill: (path: string) => void) {
  if (!node || node.isFree) {
    if (mode === 'select') onSelect(null)
    return
  }
  if (mode === 'select') {
    onSelect(node.summary.path || null)
    return
  }
  if (node.summary.flags.kind === 'dir' && node.summary.path) onDrill(node.summary.path)
}

/** AntV G2 实心饼图：引线标签；当前目录说明放在图下方，避免环心对不齐。 */
export const Pie: React.FC<PieProps> = ({
  node,
  volume,
  selectedPath: _selectedPath,
  scanning,
  canGoUp,
  onSelect,
  onDrill,
  onGoUp
}) => {
  const spec = useMemo(() => {
    if (!node) return null
    const slices = toPieData(node)
    const total = pieSliceTotal(slices)
    return {
      type: 'interval',
      data: slices,
      paddingLeft: 108,
      paddingRight: 108,
      paddingTop: 20,
      paddingBottom: 20,
      encode: { y: 'value', color: 'color' },
      transform: [{ type: 'stackY' }],
      coordinate: { type: 'theta', innerRadius: 0, outerRadius: 0.78 },
      legend: false,
      axis: false,
      scale: { color: { type: 'identity' } },
      animate: false,
      interaction: CHART_HIGHLIGHT,
      state: CHART_HIGHLIGHT_STATE,
      style: {
        viewFill: 'transparent',
        fill: (d: unknown) => fillOf(d),
        fillOpacity: 1,
        stroke: '#070b11',
        lineWidth: 1.2,
        cursor: 'pointer'
      },
      labels: [
        {
          text: (d: unknown) => unwrapChartNode(d)?.label ?? '',
          position: 'outside',
          connector: (d: unknown) => Boolean(unwrapChartNode(d)?.label),
          ...PIE_LABEL_CONNECTOR,
          fill: '#b7c9c4',
          fontSize: 11,
          fontWeight: 500,
          connectorStroke: 'rgba(183, 201, 196, 0.7)',
          connectorLineWidth: 1,
          pointerEvents: 'none',
          connectorPointerEvents: 'none'
        }
      ],
      tooltip: {
        title: (d: unknown) => unwrapChartNode(d)?.name ?? '',
        items: [
          (d: unknown) => {
            const n = unwrapChartNode(d)
            return { name: '占用', value: formatBytes(n?.summary.allocatedBytes ?? 0) }
          },
          (d: unknown) => {
            const n = unwrapChartNode(d)
            return { name: '占比', value: n ? formatShare(n.value, total) : '—' }
          }
        ]
      }
    }
  }, [node])

  const { hostRef } = useG2Chart(
    spec,
    {
      onClick: (ev, chart: G2Chart) => act(nodeFromChartEvent(chart, ev), 'select', onSelect, onDrill),
      onDblClick: (ev, chart: G2Chart) => act(nodeFromChartEvent(chart, ev), 'drill', onSelect, onDrill)
    },
    { dataKey: chartLayerKey(node) }
  )

  const captionName = node?.name ?? '…'
  const usedVolume = volume ? Math.max(0, volume.totalBytes - volume.availableBytes) : 0
  const ofUsed = volume && usedVolume > 0 && node ? formatShare(node.allocatedBytes, usedVolume) : null

  return (
    <div className={`pie-wrap ${scanning ? 'is-scanning' : ''}`}>
      <div ref={hostRef} className="g2-host" role="img" aria-label="目录占用饼图" />
      {node && (
        <button
          type="button"
          className={`pie-caption ${canGoUp ? 'can-up' : ''}`}
          disabled={!canGoUp}
          onClick={() => {
            if (canGoUp) onGoUp()
          }}
        >
          <span className="center-name">{captionName.length > 28 ? `${captionName.slice(0, 27)}…` : captionName}</span>
          <span className="pie-caption-meta">
            <span className="center-size">{formatBytes(node.allocatedBytes)}</span>
            {ofUsed && <span className="center-vol">占已用 {ofUsed}</span>}
          </span>
          <span className="center-hint">
            {scanning && !node.complete ? '扫描中…' : canGoUp ? '点击返回上级' : '双击扇区下钻'}
          </span>
        </button>
      )}
    </div>
  )
}

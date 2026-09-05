import React, { useState } from 'react'

import { categoryColor, extCategory, formatBytes } from '../format'
import type { ExtStat } from '../types'

interface ExtLegendProps {
  items: ExtStat[]
}

/** 图表面板底部只读图例：前 10 名扩展名，不做过滤。 */
export const ExtLegend: React.FC<ExtLegendProps> = ({ items }) => {
  const [hot, setHot] = useState<string | null>(null)
  const top = items.slice(0, 10)
  if (top.length === 0) return null

  return (
    <ul className="ext-legend">
      {top.map((item) => (
        <li
          key={item.ext}
          className={`ext-legend-item ${hot === item.ext ? 'is-hot' : ''}`}
          onMouseEnter={() => setHot(item.ext)}
          onMouseLeave={() => setHot(null)}
        >
          <i className="ext-dot" style={{ background: categoryColor(extCategory(item.ext)) }} />
          <span className="ext-name">{item.ext}</span>
          <span className="ext-bytes">{formatBytes(item.bytes)}</span>
          <span className="ext-files">{item.files.toLocaleString()} 个</span>
        </li>
      ))}
    </ul>
  )
}

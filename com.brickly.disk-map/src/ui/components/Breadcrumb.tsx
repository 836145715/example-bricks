import { ChevronRight } from 'lucide-react'
import React from 'react'

import { joinSegments, pathSegments } from '../format'

interface BreadcrumbProps {
  root: string
  path: string
  onNavigate: (path: string) => void
}

/** 当前目录面包屑：根之内的段可点击跳转。 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({ root, path, onNavigate }) => {
  const segments = pathSegments(path)
  // 只渲染扫描根之内的段。
  const rootSegments = pathSegments(root)
  const startIndex = rootSegments.length
  const visible = segments.slice(startIndex)

  const pathUpTo = (count: number): string => {
    const base = rootSegments.slice(0, Math.min(count, rootSegments.length))
    const joined = joinSegments(base)
    const extra = segments.slice(base.length, count)
    if (extra.length === 0) return joined
    return (joined === '/' ? '' : joined) + '/' + extra.join('/')
  }

  return (
    <nav className="breadcrumb" aria-label="目录路径">
      {segments.map((seg, index) => {
        const target = pathUpTo(index + 1)
        const clickable = index >= startIndex - 1 && target !== path
        const label = seg === '/' ? (root === '/' ? '/' : '磁盘') : seg
        return (
          <React.Fragment key={`${seg}-${index}`}>
            {index > 0 && <ChevronRight size={12} className="crumb-sep" />}
            <button
              type="button"
              className={`crumb ${target === path ? 'active' : ''} ${clickable ? 'clickable' : ''}`}
              onClick={() => clickable && onNavigate(target)}
            >
              {label}
            </button>
          </React.Fragment>
        )
      })}
    </nav>
  )
}

import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { SessionRow, SortField, SortOrder } from '../types'
import { formatBytes, formatProcess } from '../utils/formatters'
import { ArrowDown, ArrowUp, ArrowUpDown, Activity } from 'lucide-react'

type SessionTableProps = {
  visibleRows: SessionRow[]
  selectedId: number | null
  loadDetail: (id: number) => void
  viewportRef: React.RefObject<HTMLDivElement | null>
  sortField: SortField
  sortOrder: SortOrder
  changeSort: (field: SortField) => void
}

export function SessionTable({
  visibleRows,
  selectedId,
  loadDetail,
  viewportRef,
  sortField,
  sortOrder,
  changeSort
}: SessionTableProps) {
  // 虚拟滚动核心状态
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  // 虚拟化固定配置参数 (与 CSS 中 row=30px, row-head=32px 完全同步)
  const rowHeight = 30
  const headerHeight = 32
  const bufferRows = 10

  // 监听容器滚动和视口大小变动，进行高性能节流渲染
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    // 初始化视口参数
    setViewportHeight(el.clientHeight)
    setScrollTop(el.scrollTop)

    const handleScroll = () => {
      // 使用 requestAnimationFrame 在显示器刷新前夜触发更新，达成 60/120 FPS 极限丝滑
      window.requestAnimationFrame(() => {
        if (el) {
          setScrollTop(el.scrollTop)
        }
      })
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // 精确监控尺寸
        setViewportHeight(entry.contentRect.height || el.clientHeight)
      }
    })

    el.addEventListener('scroll', handleScroll, { passive: true })
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [viewportRef])

  // 虚拟计算核心逻辑
  const totalRows = visibleRows.length
  const totalHeight = totalRows * rowHeight

  // 1. 估算当前渲染的起始索引和结束索引 (减去表头 32 像素偏移)
  const startIndex = Math.max(
    0,
    Math.floor((scrollTop - headerHeight) / rowHeight) - bufferRows
  )
  const endIndex = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight - headerHeight) / rowHeight) + bufferRows
  )

  // 2. 切片需要真实被渲染出来的会话行集合
  const itemsToRender = visibleRows.slice(startIndex, endIndex)
  
  // 3. 计算偏移像素量
  const offsetY = startIndex * rowHeight

  // 渲染排序图标指示器
  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown size={11} className="sort-icon sort-icon-inactive" />
    }
    return sortOrder === 'asc' 
      ? <ArrowUp size={11} className="sort-icon sort-icon-active" /> 
      : <ArrowDown size={11} className="sort-icon sort-icon-active" />
  }

  return (
    <div className="table" ref={viewportRef}>
      {/* 粘性表头：固定高度 32px */}
      <div className="row row-head">
        <span className="sortable-header" onClick={() => changeSort('id')}>
          # {renderSortIcon('id')}
        </span>
        <span>状态码</span>
        <span className="sortable-header" onClick={() => changeSort('protocol')}>
          协议 {renderSortIcon('protocol')}
        </span>
        <span className="sortable-header" onClick={() => changeSort('method')}>
          方式 {renderSortIcon('method')}
        </span>
        <span className="sortable-header" onClick={() => changeSort('host')}>
          Host {renderSortIcon('host')}
        </span>
        <span>URL / Path</span>
        <span>响应IP</span>
        <span className="sortable-header" onClick={() => changeSort('size')}>
          返回长度 {renderSortIcon('size')}
        </span>
        <span>类型</span>
        <span className="sortable-header" onClick={() => changeSort('duration')}>
          备注 (耗时) {renderSortIcon('duration')}
        </span>
        <span>客户端用户名</span>
        <span>进程信息</span>
      </div>
      
      {totalRows === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Activity size={36} className="empty-icon-svg" />
          </div>
          <h3>暂无会话</h3>
          <p>捕获尚未开启，或者所有会话已被过滤规则屏蔽。</p>
        </div>
      ) : (
        /* 虚拟化撑高容器：总高度为所有会话累计行高 */
        <div 
          className="virtual-scroll-spacer" 
          style={{ 
            height: `${totalHeight}px`, 
            position: 'relative', 
            width: '100%',
            minWidth: '1394px' 
          }}
        >
          {/* 绝对定位的视口容器：通过 translateY 向上/向下平移 */}
          <div 
            className="virtual-scroll-body" 
            style={{ 
              transform: `translateY(${offsetY}px)`, 
              position: 'absolute', 
              left: 0, 
              right: 0, 
              top: 0 
            }}
          >
            {itemsToRender.map((row) => (
              <button
                key={row.id}
                className={clsx('row', selectedId === row.id && 'row-active', row.error && 'row-error')}
                onClick={() => void loadDetail(row.id)}
                type="button"
              >
                <span className="col-id">{row.id}</span>
                <span className={clsx(
                  "col-status",
                  row.status && row.status >= 200 && row.status < 300 && "status-success",
                  row.status && row.status >= 300 && row.status < 400 && "status-redirect",
                  row.status && row.status >= 400 && "status-error"
                )}>
                  {row.status || row.phase}
                </span>
                <span className={clsx('proto', `proto-${row.protocol.toLowerCase()}`)}>{row.protocol}</span>
                <span>{row.method || row.direction || '-'}</span>
                <span className="col-host" title={row.host}>{row.host || '-'}</span>
                <span className="col-path" title={row.path || row.url}>{row.path || row.url || '-'}</span>
                <span>{row.remoteAddress || row.localAddress || '-'}</span>
                <span>{formatBytes((row.requestBytes || 0) + (row.responseBytes || 0) + (row.bodyBytes || 0))}</span>
                <span>{row.error ? 'error' : '-'}</span>
                <span>{row.error || (row.durationMs ? `${row.durationMs} ms` : '')}</span>
                <span>-</span>
                <span>{formatProcess(row)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

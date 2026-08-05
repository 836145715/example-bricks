import clsx from 'clsx'
import { ListFilter, Loader2, Network, RefreshCw, Search, X } from 'lucide-react'
import React from 'react'
import type { Mode, ProtocolFilter } from '../types'
import { QuickPresets } from './QuickPresets'

interface HeaderHudProps {
  mode: Mode
  setMode: (m: Mode) => void
  port: string
  setPort: (p: string) => void
  query: string
  setQuery: (q: string) => void
  protocol: ProtocolFilter
  setProtocol: (p: ProtocolFilter) => void
  includeEstablished: boolean
  setIncludeEstablished: (inc: boolean) => void
  busy: boolean
  canLookup: boolean
  onRunLookup: (targetPort?: number) => void
  onRunList: () => void
  onRefresh: () => void
}

/**
 * 顶部控制台 HUD 组件 - 包含操作模式、参数筛选与触发按钮
 */
export const HeaderHud: React.FC<HeaderHudProps> = ({
  mode,
  setMode,
  port,
  setPort,
  query,
  setQuery,
  protocol,
  setProtocol,
  includeEstablished,
  setIncludeEstablished,
  busy,
  canLookup,
  onRunLookup,
  onRunList,
  onRefresh
}) => {
  return (
    <header className="hud">
      {/* 核心控件区域 (已移除与标题栏重复的 Brand LOGO 块) */}
      <div className="hud-controls">
        {/* 模式选择 Segment */}
        <div className="seg" role="tablist" aria-label="扫描模式">
          <button
            type="button"
            className={clsx(mode === 'list' && 'on')}
            onClick={() => setMode('list')}
            title="列出系统中正在监听或建立连接的所有端口"
          >
            <ListFilter size={13} />
            列全部
          </button>
          <button
            type="button"
            className={clsx(mode === 'port' && 'on')}
            onClick={() => setMode('port')}
            title="查看特定端口占用"
          >
            <Search size={13} />
            查端口
          </button>
        </div>

        {/* 模式专属输入框 */}
        {mode === 'port' ? (
          <div className="field-inline">
            <label htmlFor="port-input">端口</label>
            <div className="input-wrap">
              <input
                id="port-input"
                type="number"
                min={1}
                max={65535}
                step={1}
                value={port}
                placeholder="例如: 3000"
                onChange={(e) => setPort(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRunLookup()
                }}
              />
              {port && (
                <button
                  type="button"
                  className="input-clear"
                  onClick={() => setPort('')}
                  title="清空"
                  aria-label="清空端口输入"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="field-inline">
            <label htmlFor="filter-input">过滤</label>
            <div className="input-wrap">
              <input
                id="filter-input"
                className="filter"
                type="text"
                value={query}
                placeholder="端口 / PID / 进程名 / 路径"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRunList()
                }}
              />
              {query && (
                <button
                  type="button"
                  className="input-clear"
                  onClick={() => setQuery('')}
                  title="清空"
                  aria-label="清空搜索"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 协议筛选 */}
        <div className="field-inline">
          <label htmlFor="proto-select">协议</label>
          <select id="proto-select" value={protocol} onChange={(e) => setProtocol(e.target.value as ProtocolFilter)}>
            <option value="all">全部</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
        </div>

        {/* 模式额外复选框 */}
        {mode === 'list' && (
          <label className="check-inline" title="取消勾选只显示 LISTENING 监听端口">
            <input
              type="checkbox"
              checked={includeEstablished}
              onChange={(e) => setIncludeEstablished(e.target.checked)}
            />
            含已连接
          </label>
        )}
      </div>

      {/* 触发操作按钮组 */}
      <div className="hud-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (mode === 'port' && !canLookup)}
          onClick={() => (mode === 'port' ? onRunLookup() : onRunList())}
        >
          {busy ? <Loader2 className="spin" size={14} /> : <Network size={14} />}
          扫描
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={onRefresh}
          title="重新发起实时端口检测"
        >
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
          刷新
        </button>
      </div>

      {/* 常用端口快捷输入预设，仅在「查端口」模式下展开 */}
      {mode === 'port' && (
        <QuickPresets
          currentPort={port}
          disabled={busy}
          onSelectPort={(p) => onRunLookup(p)}
        />
      )}
    </header>
  )
}

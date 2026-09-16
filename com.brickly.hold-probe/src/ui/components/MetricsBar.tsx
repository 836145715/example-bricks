import { AlertCircle, CheckCircle, FileCode, Folder, Info, Lock, Search, X } from 'lucide-react'
import React from 'react'
import type { ProbeResult } from '../types'

interface MetricsBarProps {
  busy: boolean
  error: string
  path: string
  deep: boolean
  result: ProbeResult | null
  filterText: string
  filteredCount: number
  onFilterTextChange: (val: string) => void
}

function baseName(path: string): string {
  if (!path) return '未指定目标'
  const cleaned = path.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * 目标诊断与快照分析条组件
 */
export const MetricsBar: React.FC<MetricsBarProps> = ({
  busy,
  error,
  path,
  deep,
  result,
  filterText,
  filteredCount,
  onFilterTextChange
}) => {
  const isDirectory = result?.kind === 'directory' || (!result && path && !path.includes('.'))

  return (
    <div className="target-deck-bar" aria-label="目标锁定诊断面板">
      {/* 目标文件/文件夹概览信息 */}
      <div className="target-info-group">
        <div className="target-icon-badge">
          {isDirectory ? <Folder size={18} className="sky" /> : <FileCode size={18} className="cyan" />}
        </div>
        <div className="target-text-block">
          <div className="target-title-row">
            <strong className="target-name">{baseName(path)}</strong>
            {result ? (
              <span className={`status-pill ${result.count === 0 ? 'ok' : 'warn'}`}>
                {result.count === 0 ? (
                  <>
                    <CheckCircle size={12} />
                    已安全 · 无占用锁
                  </>
                ) : (
                  <>
                    <Lock size={12} />
                    锁定中 · {result.count} 个进程持有
                  </>
                )}
              </span>
            ) : busy ? (
              <span className="status-pill busy">
                <span className="spin" />
                扫描探针运行中…
              </span>
            ) : (
              <span className="status-pill idle">等待启动探针</span>
            )}
          </div>
          <span className="target-full-path" title={path || '尚未指定目标路径'}>
            {path || '拖放文件/文件夹到界面任意区域，或在上方粘贴路径'}
          </span>
        </div>
      </div>

      {/* 实时搜索过滤框 */}
      {result && result.count > 0 ? (
        <div className="filter-wrap">
          <span className="filter-icon">
            <Search size={13} />
          </span>
          <input
            type="text"
            className="filter-input"
            placeholder="搜索 PID / 进程名 / 来源..."
            value={filterText}
            onChange={(e) => onFilterTextChange(e.target.value)}
          />
          {filterText ? (
            <button
              type="button"
              className="input-clear"
              title="清空搜索"
              onClick={() => onFilterTextChange('')}
            >
              <X size={12} />
            </button>
          ) : null}
          <span className="filter-count">
            {filteredCount} / {result.count}
          </span>
        </div>
      ) : null}

      {/* 状态异常与说明 */}
      {error ? (
        <div className="target-error-inline">
          <AlertCircle size={13} />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  )
}

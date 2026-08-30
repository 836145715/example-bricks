import { CalendarDays, X } from 'lucide-react'
import { useRef } from 'react'
import {
  describeDateFilter,
  isDateFilterActive,
  type FileDateFilter,
  type FileDatePreset
} from '../domain/paths'

interface FileDateFilterControlsProps {
  filter: FileDateFilter
  matchCount: number
  availableCount: number
  onChange: (filter: FileDateFilter) => void
  onPreset: (kind: FileDatePreset) => void
  onClear: () => void
}

export function FileDateFilterControls({
  filter,
  matchCount,
  availableCount,
  onChange,
  onPreset,
  onClear
}: FileDateFilterControlsProps) {
  const active = isDateFilterActive(filter)
  const mountedAtRef = useRef(Date.now())

  const emitChange = (next: FileDateFilter) => {
    if (Date.now() - mountedAtRef.current < 400) return
    onChange(next)
  }

  return (
    <div className="file-date-filter">
      <span className="file-date-filter-label">
        <CalendarDays size={12} />
        修改日期
      </span>

      <div className="file-date-mode" role="group" aria-label="日期模式">
        <button
          type="button"
          className={filter.mode === 'day' ? 'active' : ''}
          onClick={() => emitChange({
            mode: 'day',
            startDate: filter.startDate,
            endDate: filter.startDate
          })}
        >
          单日
        </button>
        <button
          type="button"
          className={filter.mode === 'range' ? 'active' : ''}
          onClick={() => emitChange({
            mode: 'range',
            startDate: filter.startDate,
            endDate: filter.endDate || filter.startDate
          })}
        >
          范围
        </button>
      </div>

      <input
        type="date"
        className="file-date-input"
        name="log-searcher-mtime-start"
        autoComplete="off"
        value={filter.startDate}
        onChange={event => emitChange({
          ...filter,
          startDate: event.target.value,
          endDate: filter.mode === 'day' ? event.target.value : filter.endDate
        })}
        aria-label={filter.mode === 'day' ? '选择日期' : '开始日期'}
      />
      {filter.mode === 'range' && (
        <>
          <span className="file-date-sep">至</span>
          <input
            type="date"
            className="file-date-input"
            name="log-searcher-mtime-end"
            autoComplete="off"
            value={filter.endDate}
            min={filter.startDate || undefined}
            onChange={event => emitChange({
              ...filter,
              endDate: event.target.value
            })}
            aria-label="结束日期"
          />
        </>
      )}

      <button type="button" className="file-date-chip" onClick={() => onPreset('today')}>
        今天
      </button>
      <button type="button" className="file-date-chip" onClick={() => onPreset('yesterday')}>
        昨天
      </button>
      <button type="button" className="file-date-chip" onClick={() => onPreset('last7')}>
        近 7 天
      </button>

      {active && (
        <>
          <span className="file-date-filter-hint">
            {describeDateFilter(filter)} · 已选 {matchCount}/{availableCount} 个
          </span>
          <button
            type="button"
            className="file-date-clear"
            onClick={onClear}
            title="清除日期筛选"
          >
            <X size={11} />
            清除
          </button>
        </>
      )}
    </div>
  )
}

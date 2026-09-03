import { CalendarDays, X } from 'lucide-react'
import {
  describeDateFilter,
  isDateFilterActive,
  type FileDateFilter,
  type FileDatePreset
} from '../domain/paths'
import { DatePicker, DateRangePicker } from './ui/date-picker'

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
          onClick={() => onChange({
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
          onClick={() => onChange({
            mode: 'range',
            startDate: filter.startDate,
            endDate: filter.endDate || filter.startDate
          })}
        >
          范围
        </button>
      </div>

      {filter.mode === 'day' ? (
        <DatePicker
          value={filter.startDate}
          onChange={(startDate) => onChange({ mode: 'day', startDate, endDate: startDate })}
        />
      ) : (
        <DateRangePicker
          startDate={filter.startDate}
          endDate={filter.endDate}
          onChange={({ startDate, endDate }) => onChange({ mode: 'range', startDate, endDate })}
        />
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

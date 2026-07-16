import { ClockCounterClockwise, QrCode, Scan, Trash, X } from '@phosphor-icons/react'
import type { AppMode, HistoryItem } from '../types'
import { truncateText } from '../lib/history'

interface HistorySidebarProps {
  items: HistoryItem[]
  selectedId?: string | null
  /** 当前工作区模式：高亮仅对应当前模式选中项 */
  activeKind?: AppMode
  onSelect: (item: HistoryItem) => void
  onRemove: (id: string) => void
  onClear: () => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${mo}-${day} ${hh}:${mm}`
}

export function HistorySidebar({
  items,
  selectedId,
  activeKind,
  onSelect,
  onRemove,
  onClear,
}: HistorySidebarProps) {
  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-1)]">
      <div className="flex h-[52px] items-center justify-between gap-2 border-b border-[var(--line)] px-3">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--fg)]">
          <ClockCounterClockwise size={16} className="text-[var(--ac)]" weight="bold" />
          历史记录
          {activeKind && (
            <span className="ml-1 rounded bg-[var(--bg-3)] px-1.5 py-px text-[10px] font-medium text-[var(--fg-dim)]">
              {activeKind === 'decode' ? '解析' : '生成'}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[11px] text-[var(--fg-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
            title="清空全部"
          >
            <Trash size={13} />
            清空
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-3 text-center">
            <p className="text-[12.5px] text-[var(--fg-dim)]">暂无记录</p>
            <p className="text-[11px] text-[var(--fg-dim)]">解析或生成后会自动出现在这里</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const label =
                item.kind === 'decode'
                  ? item.status === 'ok'
                    ? truncateText(item.resultText || '')
                    : truncateText(item.errorMessage || '解析失败')
                  : item.status === 'ok'
                    ? truncateText(item.sourceText || '')
                    : truncateText(item.errorMessage || '生成失败')
              const thumb = item.kind === 'generate' ? item.qrDataUrl : item.previewThumb
              const active = selectedId === item.id

              return (
                <li key={item.id}>
                  <div
                    className={`group relative flex cursor-pointer gap-2 rounded-[var(--radius-sm)] border px-2 py-2 transition ${
                      active
                        ? 'border-[var(--ac-line)] bg-[var(--ac-soft)]'
                        : 'border-transparent hover:border-[var(--line)] hover:bg-[var(--bg-hover)]'
                    }`}
                    onClick={() => onSelect(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(item)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-[var(--line)] bg-[var(--bg-sunken)]">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" />
                      ) : item.kind === 'decode' ? (
                        <Scan size={16} className="text-[var(--fg-dim)]" />
                      ) : (
                        <QrCode size={16} className="text-[var(--fg-dim)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1 py-px text-[10px] font-medium ${
                            item.kind === 'decode'
                              ? 'bg-[var(--bg-3)] text-[var(--fg-muted)]'
                              : 'bg-[var(--ac-soft)] text-[var(--ac)]'
                          }`}
                        >
                          {item.kind === 'decode' ? '解析' : '生成'}
                        </span>
                        {item.status === 'error' && (
                          <span className="text-[10px] text-[var(--danger)]">失败</span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-[var(--fg-dim)]">
                          {formatTime(item.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-[var(--fg-muted)]" title={label}>
                        {label || '(空)'}
                      </p>
                      {item.kind === 'generate' && item.generateStyle && (
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--fg-dim)]">
                          <span
                            className="inline-block h-2 w-2 rounded-sm border border-black/20"
                            style={{ background: item.generateStyle.darkColor }}
                            title={item.generateStyle.darkColor}
                          />
                          <span className="truncate">
                            {item.generateStyle.moduleStyle}
                            {' · '}
                            {item.generateStyle.size}px
                          </span>
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="absolute right-1 top-1 hidden rounded p-0.5 text-[var(--fg-dim)] hover:bg-[var(--bg-2)] hover:text-[var(--fg)] group-hover:block"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemove(item.id)
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--line)] px-3 py-2 text-[10.5px] text-[var(--fg-dim)]">
        本地保存最近 {items.length}/50 条
      </div>
    </aside>
  )
}

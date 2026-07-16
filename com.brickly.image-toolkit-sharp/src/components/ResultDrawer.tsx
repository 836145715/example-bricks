import { useState } from 'react'
import {
  CaretDown,
  CaretUp,
  CheckCircle,
  Copy,
  FolderOpen,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react'
import { copyText, openFolder } from '../lib/bridge'
import { basename, formatSizeKb } from '../lib/format'
import type { ProcessImageResult } from '../types'

interface ResultDrawerProps {
  result: ProcessImageResult | null
  lastOutputPath: string | null
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void
}

export function ResultDrawer({ result, lastOutputPath, onToast }: ResultDrawerProps) {
  const [open, setOpen] = useState(true)

  if (!result) {
    return (
      <div className="border-t border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-[11.5px] text-[var(--fg-dim)]">
        暂无处理结果
      </div>
    )
  }

  const { summary, items } = result
  const openDirPath =
    lastOutputPath ||
    items.find((i) => i.ok && i.outputPath)?.outputPath ||
    null

  return (
    <div className="animate-drawer border-t border-[var(--line)] bg-[var(--bg-1)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle size={15} weight="fill" className="shrink-0 text-[var(--ok)]" />
          <span className="text-[12.5px] font-semibold text-[var(--fg)]">处理结果</span>
          <span className="truncate font-mono text-[11px] text-[var(--fg-dim)]">
            {summary.succeeded}/{summary.total} 成功
            {summary.failed > 0 ? ` · ${summary.failed} 失败` : ''}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {openDirPath ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] px-2 text-[11px] text-[var(--fg-muted)] hover:border-[var(--ac-line)] hover:text-[var(--fg)]"
              onClick={async (e) => {
                e.stopPropagation()
                const r = await openFolder(openDirPath)
                if (r.ok) onToast('已打开输出目录')
                else onToast(r.error || '打开目录失败', 'error')
              }}
            >
              <FolderOpen size={13} />
              打开目录
            </button>
          ) : null}
          {open ? <CaretDown size={14} /> : <CaretUp size={14} />}
        </div>
      </button>

      {open ? (
        <div className="scroll-y max-h-[180px] border-t border-[var(--line)] px-2 py-1.5">
          <ul className="flex flex-col gap-1">
            {items.map((item, idx) => {
              const path = item.ok ? item.outputPath || item.input : item.input
              return (
                <li
                  key={`${item.input}-${idx}`}
                  className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-sunken)] px-2 py-1.5"
                >
                  {item.ok ? (
                    <CheckCircle
                      size={14}
                      weight="fill"
                      className="mt-0.5 shrink-0 text-[var(--ok)]"
                    />
                  ) : (
                    <XCircle
                      size={14}
                      weight="fill"
                      className="mt-0.5 shrink-0 text-[var(--danger)]"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-[var(--fg)]">
                        {basename(path)}
                      </span>
                      {item.ok ? (
                        <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-dim)]">
                          {formatSizeKb(item.sizeKb, item.sizeBytes)}
                          {item.width && item.height
                            ? ` · ${item.width}×${item.height}`
                            : ''}
                          {item.format ? ` · ${item.format}` : ''}
                        </span>
                      ) : null}
                    </div>
                    {item.ok && item.outputPath ? (
                      <button
                        type="button"
                        className="mt-0.5 flex max-w-full items-center gap-1 text-left font-mono text-[10.5px] text-[var(--fg-dim)] hover:text-[var(--ac)]"
                        title="复制路径"
                        onClick={async () => {
                          const ok = await copyText(item.outputPath!)
                          onToast(ok ? '路径已复制' : '复制失败', ok ? 'success' : 'error')
                        }}
                      >
                        <Copy size={11} className="shrink-0" />
                        <span className="truncate">{item.outputPath}</span>
                      </button>
                    ) : (
                      <div className="mt-0.5 flex items-start gap-1 text-[11px] text-[var(--danger)]">
                        <WarningCircle size={12} className="mt-0.5 shrink-0" />
                        <span>
                          {item.error?.message || '处理失败'}
                          {item.error?.code ? ` (${item.error.code})` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

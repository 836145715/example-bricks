import { CircleNotch, Eye, FolderOpen, Trash } from '@phosphor-icons/react'

interface ProcessBarProps {
  fileCount: number
  isRunning: boolean
  progress: number
  progressMessage: string
  canOpenFolder: boolean
  /** Disable memory preview (e.g. PDF merge) */
  previewDisabled?: boolean
  onClear: () => void
  onOpenFolder: () => void
  onPreview: () => void
  onProcess: () => void
}

export function ProcessBar({
  fileCount,
  isRunning,
  progress,
  progressMessage,
  canOpenFolder,
  previewDisabled = false,
  onClear,
  onOpenFolder,
  onPreview,
  onProcess,
}: ProcessBarProps) {
  const processLabel =
    fileCount <= 0 ? '处理并保存' : fileCount === 1 ? '处理并保存' : `处理并保存 ${fileCount} 张`

  return (
    <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-[var(--line)] bg-[var(--bg-1)]/90 px-3 backdrop-blur-md">
      <button
        type="button"
        onClick={onClear}
        disabled={fileCount === 0 || isRunning}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-2.5 text-[12px] text-[var(--fg-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-40"
      >
        <Trash size={14} />
        清空
      </button>
      <button
        type="button"
        onClick={onOpenFolder}
        disabled={!canOpenFolder || isRunning}
        className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-2.5 text-[12px] text-[var(--fg-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] disabled:opacity-40"
      >
        <FolderOpen size={14} />
        打开目录
      </button>

      <div className="min-w-0 flex-1 px-2">
        {isRunning ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] text-[var(--fg-dim)]">
              <span className="truncate">{progressMessage || '处理中...'}</span>
              <span className="font-mono tabular-nums">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-3)]">
              <div
                className="h-full rounded-full bg-[var(--ac)] transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-[var(--fg-dim)]">
            预览仅内存处理不落盘 · 处理并保存会写出文件
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onPreview}
        disabled={fileCount === 0 || isRunning || previewDisabled}
        title={
          previewDisabled
            ? '当前操作不支持纯内存预览'
            : '按当前参数内存预览，不写入磁盘'
        }
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--ac-line)] bg-[var(--ac-soft)] px-3 text-[13px] font-semibold text-[var(--ac)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-45"
      >
        {isRunning ? (
          <CircleNotch size={16} className="animate-spin" />
        ) : (
          <Eye size={16} weight="bold" />
        )}
        预览
      </button>

      <button
        type="button"
        onClick={onProcess}
        disabled={fileCount === 0 || isRunning}
        className="inline-flex h-10 min-w-[120px] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--ac)] px-4 text-[13px] font-semibold text-[var(--ac-fg)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-45"
      >
        {isRunning ? (
          <>
            <CircleNotch size={16} className="animate-spin" />
            处理中
          </>
        ) : (
          processLabel
        )}
      </button>
    </footer>
  )
}

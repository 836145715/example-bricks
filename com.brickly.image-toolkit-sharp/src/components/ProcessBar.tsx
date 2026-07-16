import { CircleNotch, Eye, FolderOpen, Trash } from '@phosphor-icons/react'

interface ProcessBarProps {
  fileCount: number
  isRunning: boolean
  progress: number
  progressMessage: string
  canOpenFolder: boolean
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
  const saveLabel =
    fileCount <= 0 ? '保存' : fileCount === 1 ? '保存' : `保存 ${fileCount} 张`

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
            右侧结果随参数自动预览 · 「保存」才写入磁盘
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onPreview}
        disabled={fileCount === 0 || isRunning || previewDisabled}
        title="立即刷新内存预览"
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-2.5 text-[12px] text-[var(--fg-muted)] transition hover:border-[var(--ac-line)] hover:text-[var(--ac)] disabled:opacity-40"
      >
        <Eye size={14} />
        刷新预览
      </button>

      <button
        type="button"
        onClick={onProcess}
        disabled={fileCount === 0 || isRunning}
        className="inline-flex h-10 min-w-[100px] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--ac)] px-4 text-[13px] font-semibold text-[var(--ac-fg)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-45"
      >
        {isRunning ? (
          <>
            <CircleNotch size={16} className="animate-spin" />
            处理中
          </>
        ) : (
          saveLabel
        )}
      </button>
    </footer>
  )
}

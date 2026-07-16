import { CheckCircle, WarningCircle, Info, X } from '@phosphor-icons/react'
import type { ToastState } from '../types'

interface ToastProps {
  toast: ToastState | null
  onDismiss: () => void
}

export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null

  const Icon =
    toast.kind === 'error' ? WarningCircle : toast.kind === 'info' ? Info : CheckCircle

  const tone =
    toast.kind === 'error'
      ? 'border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]'
      : toast.kind === 'info'
        ? 'border-[var(--line)] bg-[var(--bg-2)] text-[var(--fg-muted)]'
        : 'border-[var(--ac-line)] bg-[var(--ok-soft)] text-[var(--ok)]'

  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 px-4">
      <div
        className={`animate-toast pointer-events-auto flex max-w-md items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 shadow-lg backdrop-blur-md ${tone}`}
        role="status"
      >
        <Icon size={16} weight="fill" className="shrink-0" />
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug">{toast.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
          aria-label="关闭提示"
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  )
}

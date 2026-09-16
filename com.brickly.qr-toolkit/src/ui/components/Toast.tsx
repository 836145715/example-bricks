import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react'
import { useEffect } from 'react'

export type ToastKind = 'ok' | 'error' | 'info'

export interface ToastState {
  kind: ToastKind
  text: string
}

interface ToastProps {
  toast: ToastState | null
  onClose: () => void
}

export function Toast({ toast, onClose }: ToastProps) {
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(onClose, 3200)
    return () => window.clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null

  const icon =
    toast.kind === 'ok' ? (
      <CheckCircle size={16} weight="fill" className="text-[var(--ok)]" />
    ) : toast.kind === 'error' ? (
      <WarningCircle size={16} weight="fill" className="text-[var(--danger)]" />
    ) : null

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50">
      <div className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-2)] px-3 py-2.5 shadow-lg shadow-black/30">
        {icon}
        <p className="flex-1 text-[12.5px] leading-snug text-[var(--fg)]">{toast.text}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-[var(--fg-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

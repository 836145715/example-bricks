import * as React from 'react'
import { cn } from '@/lib/utils'

export type StatusTone = 'success' | 'info' | 'warning' | 'destructive' | 'muted'

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground/50'
}

const STATUS_DOT_SIZE_CLASS = {
  sm: 'size-1.5',
  md: 'size-2',
  lg: 'size-2.5'
}

export function StatusDot({
  tone,
  size = 'md',
  className
}: {
  tone: StatusTone
  size?: keyof typeof STATUS_DOT_SIZE_CLASS
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'status-dot shrink-0 rounded-full bg-current',
        STATUS_TONE_CLASS[tone],
        STATUS_DOT_SIZE_CLASS[size],
        className
      )}
    />
  )
}

export function StatusBadge({
  tone,
  children,
  dot = true,
  className
}: {
  tone: StatusTone
  children: React.ReactNode
  dot?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-[10px] font-semibold',
        tone === 'success' && 'border-success/30 bg-transparent text-success',
        tone === 'info' && 'hairline bg-muted/30 text-muted-foreground',
        tone === 'warning' && 'border-warning/35 bg-transparent text-warning',
        tone === 'destructive' && 'border-destructive/30 bg-transparent text-destructive',
        tone === 'muted' && 'hairline bg-muted/30 text-muted-foreground',
        className
      )}
    >
      {dot && <StatusDot tone={tone} size="sm" />}
      {children}
    </span>
  )
}

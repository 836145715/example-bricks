import * as React from 'react'
import { cn } from '@/lib/utils'

export function DataTable({
  children,
  minWidth = '720px',
  className,
  viewportClassName
}: {
  children: React.ReactNode
  minWidth?: string
  className?: string
  viewportClassName?: string
}): React.JSX.Element {
  return (
    <div className={cn('overflow-x-auto', viewportClassName)}>
      <div
        style={{ '--data-table-min-width': minWidth } as React.CSSProperties}
        className={cn(
          'min-w-[var(--data-table-min-width)] overflow-hidden rounded-md bg-background/25 ring-1 ring-border/30',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function DataTableHeader({
  columns,
  children,
  className
}: {
  columns: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid min-h-8 items-center gap-3 bg-muted/20 px-3 py-2 text-[11px] font-medium text-muted-foreground',
        columns,
        className
      )}
    >
      {children}
    </div>
  )
}

export function DataTableRow({
  columns,
  children,
  className
}: {
  columns: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'hairline grid min-h-9 items-center gap-3 border-b px-3 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/12',
        columns,
        className
      )}
    >
      {children}
    </div>
  )
}

export function DataCodeCell({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('semantic-id truncate text-xs text-muted-foreground', className)}>
      {children}
    </span>
  )
}

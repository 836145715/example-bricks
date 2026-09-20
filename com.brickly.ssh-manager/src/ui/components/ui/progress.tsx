import * as React from 'react'
import { cn } from '@/lib/utils'

function Progress({
  className,
  value = 0,
  ...props
}: { value?: number } & React.ComponentProps<'div'>): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn('bg-muted/50 relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="bg-gradient-to-r from-primary to-accent h-full transition-[width] duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export { Progress }

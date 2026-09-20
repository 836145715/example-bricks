import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedControlOption {
  value: string
  label: React.ReactNode
  badge?: React.ReactNode
}

export function SegmentedControl({
  value,
  options,
  onValueChange,
  className
}: {
  value: string
  options: SegmentedControlOption[]
  onValueChange: (value: string) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onValueChange(option.value)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-all duration-150 active:scale-[0.98] active:translate-y-[0.5px]',
              active
                ? 'hairline bg-card text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/20 hover:text-foreground'
            )}
          >
            <span>{option.label}</span>
            {option.badge != null && (
              <span
                className={cn(
                  'semantic-id rounded bg-muted/25 px-1.5 py-0.5 text-[10px]',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {option.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

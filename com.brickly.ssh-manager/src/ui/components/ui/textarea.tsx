import * as React from 'react'
import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>): React.JSX.Element {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-control-rim bg-input placeholder:text-muted-foreground flex min-h-20 w-full rounded-md border px-3 py-2 font-mono text-sm leading-relaxed outline-none transition-[color,border-color,background-color] disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/30',
        'aria-invalid:ring-destructive/30 aria-invalid:border-destructive',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

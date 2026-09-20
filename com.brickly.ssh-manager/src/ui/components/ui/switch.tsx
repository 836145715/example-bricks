import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors outline-none',
        'border-control-rim bg-control-track',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'focus-visible:ring-1 focus-visible:ring-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-switch-thumb pointer-events-none block size-3.5 rounded-full shadow-xs transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

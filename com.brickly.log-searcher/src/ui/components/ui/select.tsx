import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md'
}: {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (value: T) => void
  ariaLabel?: string
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`select-trigger select-trigger-${size}`}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{selected?.label ?? value}</span>
          <ChevronDown size={12} className={open ? 'is-open' : ''} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-log-overlay=""
          className={`select-menu select-menu-${size}`}
          role="listbox"
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`select-option${option.value === value ? ' is-selected' : ''}`}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={12} strokeWidth={2} /> : null}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

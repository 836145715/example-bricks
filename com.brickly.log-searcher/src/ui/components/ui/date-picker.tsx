import * as Popover from '@radix-ui/react-popover'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { formatLocalDateKey, parseLocalDateKey } from '../../domain/paths'
import { Calendar } from './calendar'

export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期'
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = parseLocalDateKey(value)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="date-picker-trigger"
          data-empty={!value || undefined}
          aria-label={placeholder}
        >
          <CalendarDays size={12} />
          <span>{value || placeholder}</span>
          <ChevronDown size={12} className={open ? 'is-open' : ''} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-log-overlay=""
          className="date-picker-popover"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (!date) return
              onChange(formatLocalDateKey(date))
              setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  placeholder = '选择区间'
}: {
  startDate: string
  endDate: string
  onChange: (next: { startDate: string; endDate: string }) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const from = parseLocalDateKey(startDate)
  const to = parseLocalDateKey(endDate)
  const selected: DateRange | undefined = from ? { from, to } : undefined
  const label = from && to
    ? `${startDate} - ${endDate}`
    : from
      ? `${startDate} 起`
      : placeholder

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="date-picker-trigger"
          data-empty={!from || undefined}
          aria-label={placeholder}
        >
          <CalendarDays size={12} />
          <span>{label}</span>
          <ChevronDown size={12} className={open ? 'is-open' : ''} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-log-overlay=""
          className="date-picker-popover"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
        >
          <Calendar
            mode="range"
            selected={selected}
            defaultMonth={from}
            numberOfMonths={1}
            resetOnSelect
            onSelect={(range) => {
              onChange({
                startDate: range?.from ? formatLocalDateKey(range.from) : '',
                endDate: range?.to ? formatLocalDateKey(range.to) : ''
              })
              if (range?.from && range.to) setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

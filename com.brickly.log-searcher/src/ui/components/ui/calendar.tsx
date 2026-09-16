import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'
import { zhCN } from 'react-day-picker/locale'
import 'react-day-picker/style.css'

export type CalendarProps = DayPickerProps

export function Calendar({ className, components, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays
      {...props}
      locale={zhCN}
      weekStartsOn={1}
      className={['log-calendar', className].filter(Boolean).join(' ')}
      components={{
        Chevron: ({ className: chevronClassName, orientation }) => {
          const Icon = orientation === 'right' ? ChevronRight : ChevronLeft
          return <Icon className={chevronClassName} size={14} strokeWidth={2} />
        },
        ...components
      }}
    />
  )
}

import React from 'react'
import clsx from 'clsx'

type MetricProps = {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  tone?: 'ok' | 'bad' | 'info'
}

export function Metric({ icon, label, value, tone }: MetricProps) {
  return (
    <div className={clsx('metric', tone && `metric-${tone}`)}>
      {icon}
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
    </div>
  )
}

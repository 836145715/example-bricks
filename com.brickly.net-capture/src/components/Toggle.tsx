import clsx from 'clsx'

type ToggleProps = {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}

export function Toggle({ label, checked, disabled, onChange }: ToggleProps) {
  return (
    <label className={clsx('toggle', checked && 'toggle-on', disabled && 'toggle-disabled')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

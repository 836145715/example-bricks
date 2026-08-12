export function formatBytes(value?: number): string {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${(value / 1024 ** 3).toFixed(1)} GiB`
}

export function formatDuration(value?: number): string {
  if (value === undefined) return '—'
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`
}

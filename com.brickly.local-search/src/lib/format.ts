import type { SearchItem } from '../types'

export function joinPath(item: SearchItem | null) {
  if (!item) return ''
  if (item.fullPath) return item.fullPath
  if (!item.path) return item.name
  return `${item.path.replace(/[\\/]+$/, '')}\\${item.name}`
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatTime(value: number, short = false) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return short
    ? date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : date.toLocaleString('zh-CN')
}

export function errorMessage(error: unknown) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message)
  return String(error)
}

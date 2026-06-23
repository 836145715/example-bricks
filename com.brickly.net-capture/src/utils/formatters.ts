import { DriverMode, SessionRow } from '../types'

export const driverOptions: Array<{ value: DriverMode; label: string }> = [
  { value: 'off', label: '关闭驱动' },
  { value: 'proxifier', label: 'Proxifier' },
  { value: 'nfapi', label: 'NFAPI' },
  { value: 'tun', label: 'TUN' }
]

/**
 * 格式化字节数，转换为 B, KB, MB
 */
export function formatBytes(size: number): string {
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 格式化会话所属的进程信息
 */
export function formatProcess(row: SessionRow): string {
  const pid = row.pid ? `pid=${row.pid}` : ''
  const process = row.process ? `[${row.process}]` : ''
  return `${pid} ${process}`.trim() || '-'
}

/**
 * 解析错误对象为文本消息
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 根据驱动模式获取对应的文字标签
 */
export function driverLabel(value: DriverMode): string {
  return driverOptions.find((item) => item.value === value)?.label || '关闭驱动'
}

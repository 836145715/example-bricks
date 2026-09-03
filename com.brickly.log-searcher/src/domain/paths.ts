import { formatLogFileSize, getLogFileName, type RemoteLogFile } from './logFiles'
import type { FileListStatus } from '../types'

export type FilePickerSort = 'mtime' | 'name' | 'size'

export interface LogFileGroup {
  dir: string
  files: RemoteLogFile[]
}

export interface RemoteBrowseEntry {
  name: string
  path: string
  kind: 'dir' | 'file' | 'other'
  sizeBytes?: number
  modifiedAt?: number
  searchable?: boolean
}

export interface RemoteBrowseResult {
  path: string
  parent?: string
  pattern?: string
  entries: RemoteBrowseEntry[]
  truncated?: boolean
}

export interface PathPreset {
  label: string
  path: string
}

export const LOG_PATH_PRESETS: PathPreset[] = [
  { label: '系统日志', path: '/var/log/*.log' },
  { label: 'Nginx', path: '/var/log/nginx/*.log' },
  { label: '容器', path: '/var/log/containers/*.log' },
  { label: '家目录日志', path: '~/logs/*.log' }
]

export const BROWSE_SHORTCUTS: PathPreset[] = [
  { label: '/var/log', path: '/var/log' },
  { label: '家目录', path: '~' },
  { label: '/home', path: '/home' },
  { label: '/opt', path: '/opt' }
]

export const getParentDir = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/')
  const index = Math.max(normalized.lastIndexOf('/'), 0)
  if (index === 0) {
    return normalized.startsWith('/') ? '/' : ''
  }
  return normalized.slice(0, index)
}

export const toDirectoryGlob = (dir: string, suffix = '*'): string => {
  const base = !dir || dir === '/' ? '' : dir.replace(/\/+$/, '')
  const cleanSuffix = suffix.replace(/^\/+/, '')
  return `${base}/${cleanSuffix}`
}

export const splitRemotePathSegments = (path: string): Array<{ label: string; path: string }> => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  if (normalized === '/') {
    return [{ label: '/', path: '/' }]
  }
  const parts = normalized.split('/').filter(Boolean)
  const segments = [{ label: '/', path: '/' }]
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    segments.push({ label: part, path: current })
  }
  return segments
}

export const sortRemoteLogFilesBy = (files: RemoteLogFile[], sort: FilePickerSort): RemoteLogFile[] => {
  return [...files].sort((left, right) => {
    if (sort === 'mtime') {
      const diff = (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)
      return diff !== 0 ? diff : left.path.localeCompare(right.path)
    }
    if (sort === 'size') {
      const diff = (right.sizeBytes ?? 0) - (left.sizeBytes ?? 0)
      return diff !== 0 ? diff : left.path.localeCompare(right.path)
    }
    return getLogFileName(left.path).localeCompare(getLogFileName(right.path), 'zh-CN')
  })
}

export const groupRemoteLogFiles = (files: RemoteLogFile[], sort: FilePickerSort): LogFileGroup[] => {
  const grouped = new Map<string, RemoteLogFile[]>()
  for (const file of files) {
    const dir = getParentDir(file.path)
    const current = grouped.get(dir) ?? []
    current.push(file)
    grouped.set(dir, current)
  }

  const groups = [...grouped.entries()].map(([dir, items]) => ({
    dir,
    files: sortRemoteLogFilesBy(items, sort)
  }))

  groups.sort((left, right) => {
    if (sort === 'size') {
      const diff = groupSize(right) - groupSize(left)
      return diff !== 0 ? diff : left.dir.localeCompare(right.dir)
    }
    if (sort === 'mtime') {
      const diff = groupMtime(right) - groupMtime(left)
      return diff !== 0 ? diff : left.dir.localeCompare(right.dir)
    }
    return left.dir.localeCompare(right.dir)
  })
  return groups
}

export const recentRemoteLogFiles = (files: RemoteLogFile[], limit = 5): RemoteLogFile[] => {
  return sortRemoteLogFilesBy(files, 'mtime').slice(0, limit)
}

export type FileDateFilterMode = 'day' | 'range'
export type FileDatePreset = 'today' | 'yesterday' | 'last7'

export interface FileDateFilter {
  mode: FileDateFilterMode
  startDate: string
  endDate: string
}

export const DEFAULT_FILE_DATE_FILTER: FileDateFilter = {
  mode: 'day',
  startDate: '',
  endDate: ''
}

export const formatLocalDateKey = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export const parseLocalDateKey = (value: string): Date | undefined => {
  if (!isValidDateKey(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const isValidDateKey = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export const normalizeDateFilter = (filter: FileDateFilter): FileDateFilter => {
  if (filter.mode === 'day') {
    return { mode: 'day', startDate: filter.startDate, endDate: filter.startDate }
  }
  if (isValidDateKey(filter.startDate) && isValidDateKey(filter.endDate) && filter.endDate < filter.startDate) {
    return { mode: 'range', startDate: filter.endDate, endDate: filter.startDate }
  }
  return filter
}

export const isDateFilterActive = (filter?: FileDateFilter | null): filter is FileDateFilter => {
  if (!filter) return false
  const normalized = normalizeDateFilter(filter)
  if (!isValidDateKey(normalized.startDate)) return false
  return normalized.mode === 'day' || isValidDateKey(normalized.endDate)
}

export const localDateRangeUnixSeconds = (
  startDate: string,
  endDate: string
): { start: number; endExclusive: number } | null => {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) return null
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
  const start = new Date(startYear, startMonth - 1, startDay)
  const endExclusive = new Date(endYear, endMonth - 1, endDay + 1)
  if (endExclusive.getTime() <= start.getTime()) return null
  return {
    start: Math.floor(start.getTime() / 1000),
    endExclusive: Math.floor(endExclusive.getTime() / 1000)
  }
}

export const filterFilesByModifiedDate = (
  files: RemoteLogFile[],
  filter: FileDateFilter
): RemoteLogFile[] => {
  const normalized = normalizeDateFilter(filter)
  const endDate = normalized.mode === 'day' ? normalized.startDate : normalized.endDate
  const bounds = localDateRangeUnixSeconds(normalized.startDate, endDate)
  if (!bounds) return []
  return files.filter(file => {
    const modifiedAt = file.modifiedAt
    return typeof modifiedAt === 'number' && modifiedAt >= bounds.start && modifiedAt < bounds.endExclusive
  })
}

export const pathsMatchingDateFilter = (files: RemoteLogFile[], filter: FileDateFilter): string[] => {
  return filterFilesByModifiedDate(files, filter).map(file => file.path)
}

export const dateFilterPreset = (kind: FileDatePreset, now = new Date()): FileDateFilter => {
  const today = formatLocalDateKey(now)
  if (kind === 'today') {
    return { mode: 'day', startDate: today, endDate: today }
  }
  if (kind === 'yesterday') {
    const yesterday = formatLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
    return { mode: 'day', startDate: yesterday, endDate: yesterday }
  }
  const start = formatLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))
  return { mode: 'range', startDate: start, endDate: today }
}

export const describeDateFilter = (filter?: FileDateFilter | null): string => {
  if (!filter || !isDateFilterActive(filter)) return ''
  const normalized = normalizeDateFilter(filter)
  if (normalized.mode === 'day' || normalized.startDate === normalized.endDate) {
    return normalized.startDate
  }
  return `${normalized.startDate} ~ ${normalized.endDate}`
}

export const formatRelativeModifiedAt = (unixSeconds?: number, nowMs = Date.now()): string => {
  if (!unixSeconds || unixSeconds <= 0) return ''
  const elapsedMs = Math.max(0, nowMs - unixSeconds * 1000)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsedMs < minute) return '刚刚'
  if (elapsedMs < hour) return `${Math.floor(elapsedMs / minute)} 分钟前`
  if (elapsedMs < day) return `${Math.floor(elapsedMs / hour)} 小时前`
  if (elapsedMs < 7 * day) return `${Math.floor(elapsedMs / day)} 天前`
  const date = new Date(unixSeconds * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${dayOfMonth}`
}

export const formatBrowseEntryMeta = (entry: Pick<RemoteBrowseEntry, 'kind' | 'sizeBytes' | 'modifiedAt'>): string => {
  if (entry.kind === 'dir') {
    return formatRelativeModifiedAt(entry.modifiedAt) || '目录'
  }
  const parts = [
    entry.sizeBytes !== undefined ? formatLogFileSize(entry.sizeBytes) : '',
    formatRelativeModifiedAt(entry.modifiedAt)
  ].filter(Boolean)
  return parts.join(' · ')
}

export const getFilePickerTriggerLabel = (
  status: FileListStatus,
  files: RemoteLogFile[],
  selected: string[],
  dateLabel = ''
): string => {
  if (files.length === 0 && status === 'loading') return '正在列出日志文件…'
  if (files.length === 0 && status === 'error') return '文件列表加载失败'
  if (files.length === 0) return '未发现可检索日志'
  if (selected.length === 0) {
    return dateLabel ? `${dateLabel} · 无匹配文件` : '选择日志文件'
  }
  if (dateLabel) return `${dateLabel} · ${selected.length} 个`
  if (selected.length === files.length) return `已选全部 ${files.length} 个`
  const names = selected.slice(0, 2).map(getLogFileName)
  if (selected.length <= 2) return names.join('、')
  return `${names.join('、')} 等 ${selected.length} 个`
}

export const getGroupSelectionState = (
  files: RemoteLogFile[],
  selected: Set<string>
): 'all' | 'some' | 'none' => {
  const selectedCount = files.filter(file => selected.has(file.path)).length
  if (selectedCount === 0) return 'none'
  if (selectedCount === files.length) return 'all'
  return 'some'
}

const groupSize = (group: LogFileGroup): number => {
  return group.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0)
}

const groupMtime = (group: LogFileGroup): number => {
  return group.files.reduce((latest, file) => Math.max(latest, file.modifiedAt ?? 0), 0)
}

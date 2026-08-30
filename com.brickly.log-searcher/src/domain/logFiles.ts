export interface LogPathConfig {
  path: string
  enabled: boolean
}

export interface RemoteLogFile {
  path: string
  sizeBytes?: number
  modifiedAt?: number
  mimeType?: string
}

interface ParsedLogFileInfo {
  filePath: string
  baseName: string
  dateStr: string
  volIndex: number
  isMain: boolean
  isError: boolean
}

export const getLogFileName = (filePath: string): string => {
  return filePath.substring(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
}

export const formatLogFileSize = (sizeBytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, sizeBytes)
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  const precision = unitIndex === 0 || value >= 10 ? 0 : 1
  return `${Number(value.toFixed(precision))} ${units[unitIndex]}`
}

export const isSearchableLogFile = (file: RemoteLogFile): boolean => {
  if (!file.mimeType) return true
  const mimeType = file.mimeType.toLowerCase()
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
    || mimeType === 'application/x-ndjson'
    || mimeType === 'inode/x-empty'
}

export const sortRemoteLogFilesByModifiedAt = (files: RemoteLogFile[]): RemoteLogFile[] => {
  return [...files].sort((a, b) => {
    const modifiedAtDiff = (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0)
    if (modifiedAtDiff !== 0) return modifiedAtDiff
    return a.path.localeCompare(b.path)
  })
}

export const normalizeRemoteLogFiles = (response: unknown): RemoteLogFile[] => {
  if (typeof response !== 'object' || response === null) return []

  const data = response as Record<string, unknown>
  const paths: string[] = []
  const filesByPath = new Map<string, RemoteLogFile>()
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim() !== '') {
      if (!filesByPath.has(value)) paths.push(value)
      filesByPath.set(value, filesByPath.get(value) ?? { path: value })
      return
    }
    if (typeof value !== 'object' || value === null) return

    const file = value as Record<string, unknown>
    if (typeof file.path !== 'string' || file.path.trim() === '') return
    const sizeBytes = typeof file.sizeBytes === 'number' && Number.isFinite(file.sizeBytes) && file.sizeBytes >= 0
      ? file.sizeBytes
      : undefined
    const modifiedAt = typeof file.modifiedAt === 'number' && Number.isFinite(file.modifiedAt) && file.modifiedAt >= 0
      ? file.modifiedAt
      : undefined
    const mimeType = typeof file.mimeType === 'string' && file.mimeType.trim() !== ''
      ? file.mimeType
      : undefined
    if (!filesByPath.has(file.path)) paths.push(file.path)
    const normalizedFile: RemoteLogFile = { path: file.path }
    if (sizeBytes !== undefined) normalizedFile.sizeBytes = sizeBytes
    if (modifiedAt !== undefined) normalizedFile.modifiedAt = modifiedAt
    if (mimeType !== undefined) normalizedFile.mimeType = mimeType
    filesByPath.set(file.path, normalizedFile)
  }

  if (Array.isArray(data.files)) data.files.forEach(add)
  if (Array.isArray(data.fileInfos)) data.fileInfos.forEach(add)
  return paths.map(path => filesByPath.get(path)!).filter(Boolean)
}

const parseLogFileInfo = (filePath: string): ParsedLogFileInfo => {
  const original = getLogFileName(filePath)
  const dateReg = /(?:^|[-_\.])((?:19|20)\d{2})[-_\.]?((?:0[1-9]|1[0-2]))[-_\.]?((?:0[1-9]|[12]\d|3[01]))(?:$|[-_\.])/
  const match = original.match(dateReg)
  const isError = original.toLowerCase().includes('error')

  if (!match) {
    return {
      filePath,
      baseName: original.toLowerCase(),
      dateStr: '',
      volIndex: -1,
      isMain: true,
      isError
    }
  }

  const [, year, month, day] = match
  const dateStr = `${year}-${month}-${day}`
  const dateMatchStr = match[0]
  const dateIdx = original.indexOf(dateMatchStr)
  const prefix = original.substring(0, dateIdx).replace(/[-_\.]+$/, '').toLowerCase()
  const suffixPart = original.substring(dateIdx + dateMatchStr.length)
  const volMatch = suffixPart.match(/^([0-9]+)/)
  const extMatch = original.match(/(\.[a-zA-Z0-9]+)$/)

  return {
    filePath,
    baseName: prefix + (extMatch ? extMatch[1].toLowerCase() : ''),
    dateStr,
    volIndex: volMatch ? parseInt(volMatch[1], 10) : -1,
    isMain: false,
    isError
  }
}

const compareLogFileInfo = (a: ParsedLogFileInfo, b: ParsedLogFileInfo): number => {
  if (a.isError && !b.isError) return 1
  if (!a.isError && b.isError) return -1

  if (a.baseName < b.baseName) return -1
  if (a.baseName > b.baseName) return 1

  if (a.isMain && !b.isMain) return -1
  if (!a.isMain && b.isMain) return 1

  if (a.dateStr > b.dateStr) return -1
  if (a.dateStr < b.dateStr) return 1

  if (a.volIndex !== b.volIndex) {
    return a.volIndex - b.volIndex
  }

  if (a.filePath < b.filePath) return -1
  if (a.filePath > b.filePath) return 1
  return 0
}

export const sortLogFiles = (files: string[]): string[] => {
  return files.map(parseLogFileInfo).sort(compareLogFileInfo).map(file => file.filePath)
}

export const getDefaultSelectedFiles = (files: string[], logs: LogPathConfig[]): string[] => {
  const enabledDirectPaths = new Set(logs.filter(log => log.enabled).map(log => log.path.trim()))
  return files.filter(file => enabledDirectPaths.has(file))
}

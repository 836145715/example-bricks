export interface LogPathConfig {
  path: string
  enabled: boolean
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

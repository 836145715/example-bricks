/** 与 runtime JSON 契约一一对应（见 runtime/go/main.go）。 */

export interface SearchItem {
  name: string
  path: string // 父目录
  type: number // 1=file 2=dir 3=symlink 4=other 5=app bundle
  size: number
  mtime: number // epoch 秒
}

export interface SearchResponse {
  items: SearchItem[]
  count: number
  elapsedMs: number
}

export interface StatusInfo {
  scanning: boolean
  monitoring: boolean
  syncing: boolean
  records: number
  liveRecords: number
  scanScanned: number
  scanDirs: number
  engineReady: boolean
  error?: string
  buildStamp?: string
}

export function fullPath(item: SearchItem): string {
  if (!item.path) return '/' + item.name
  return item.path.endsWith('/') ? item.path + item.name : item.path + '/' + item.name
}

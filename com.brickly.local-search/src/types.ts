export type SearchCategory =
  | 'all'
  | 'file'
  | 'folder'
  | 'excel'
  | 'word'
  | 'ppt'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'

export type SearchSort =
  | 'name_asc'
  | 'name_desc'
  | 'date_asc'
  | 'date_desc'
  | 'path_asc'
  | 'path_desc'
  | 'size_asc'
  | 'size_desc'
  | 'ext_asc'
  | 'ext_desc'

export interface SearchItem {
  name: string
  path: string
  fullPath: string
  extension: string
  size: number
  dateModified: number
  isFile: boolean
  isFolder: boolean
  attributes: number
}

export interface SearchResult {
  query: string
  effectiveQuery: string
  category: SearchCategory
  categoryLabel: string
  total: number
  offset: number
  limit: number
  items: SearchItem[]
}

export interface HealthStatus {
  ok: boolean
  platform: string
  architecture: string
  goVersion: string
  buildStamp: string
  dllPath: string
  dllExists: boolean
  dllLoaded: boolean
  ipcReady: boolean
  everythingError?: string
  error?: string
  checkedAt: number
}

export type PreviewKind =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'archive'
  | 'spreadsheet'
  | 'document'
  | 'directory'
  | 'unsupported'

export interface TextPreview {
  content: string
  encoding: string
  bytesRead: number
  lineCount: number
}

export interface ImagePreview {
  width?: number
  height?: number
}

export interface ArchiveEntry {
  name: string
  size: number
  compressedSize: number
  isDirectory: boolean
  modifiedAt: number
}

export interface ArchivePreview {
  entries: ArchiveEntry[]
  total: number
  truncated: boolean
}

export interface DocumentPreview {
  content: string
  encoding: string
  bytesRead: number
  lineCount: number
  package?: string
  renderer?: string
}

export interface SheetPreview {
  name: string
  rows: string[][]
  truncated: boolean
}

export interface SpreadsheetPreview {
  sheets: SheetPreview[]
  truncated: boolean
}

export interface PreviewResult {
  path: string
  name: string
  extension: string
  kind: PreviewKind
  mime: string
  fileUrl?: string
  size: number
  modifiedAt: number
  isDirectory: boolean
  supported: boolean
  status: string
  truncated: boolean
  message?: string
  reason?: string
  text?: TextPreview
  image?: ImagePreview
  archive?: ArchivePreview
  document?: DocumentPreview
  spreadsheet?: SpreadsheetPreview
  meta?: Record<string, unknown>
}

export interface LocalSearchApi {
  search(input: {
    query: string
    category: SearchCategory
    offset: number
    limit: number
    sort: SearchSort
  }): Promise<SearchResult>
  health(): Promise<HealthStatus>
  preview(input: { path: string; maxBytes?: number; maxEntries?: number }): Promise<PreviewResult>
  getFileIcon(path: string): Promise<string>
  openPath(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  copyText(text: string): Promise<unknown>
}

declare global {
  interface Window {
    localSearch?: LocalSearchApi
  }
}

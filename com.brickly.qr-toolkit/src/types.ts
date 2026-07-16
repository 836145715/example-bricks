export type AppMode = 'decode' | 'generate'

export type HistoryKind = 'decode' | 'generate'

export type HistoryStatus = 'ok' | 'error'

/** 生成时的样式快照，写入历史以便回填一致 */
export interface GenerateStyleSnapshot {
  size: number
  margin: number
  errorCorrection: 'L' | 'M' | 'Q' | 'H'
  moduleStyle: 'square' | 'rounded' | 'dots'
  darkColor: string
  lightColor: string
}

export interface HistoryItem {
  id: string
  kind: HistoryKind
  createdAt: number
  status: HistoryStatus
  /** 解析结果文本 或 生成源文本摘要展示 */
  resultText?: string
  sourceText?: string
  /** 源图缩略（解析） */
  previewThumb?: string
  /** 二维码 dataUrl 缩略（生成） */
  qrDataUrl?: string
  /** 生成样式（点击历史时按此配置还原，而非当前面板默认值） */
  generateStyle?: GenerateStyleSnapshot
  errorMessage?: string
}

export interface DecodeResult {
  ok: boolean
  text?: string
  error?: { code: string; message: string }
}

export interface GenerateResult {
  ok: boolean
  dataUrl?: string
  outputPath?: string
  size?: number
  error?: { code: string; message: string }
}

export interface QrToolkitPreload {
  getPathForFile: (file: File) => string
  openFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  /** 写入系统剪贴板图片（位图） */
  copyImageDataUrl?: (dataUrl: string) => Promise<{ ok: boolean; error?: string; method?: string }>
  joinPaths: (...args: string[]) => string
  getDirname: (filePath: string) => string
  getBasename: (filePath: string, ext?: string) => string
}

export interface BricklyApi {
  invoke: (commandId: string, input?: unknown) => Promise<unknown>
  stream?: (
    commandId: string,
    input: unknown,
    handlers: {
      onProgress?: (p: number, msg?: string) => void
      onResult?: (r: unknown) => void
      onError?: (e: { message: string }) => void
    },
  ) => void
  fs?: {
    pickDirectory?: () => Promise<string | undefined>
  }
}

declare global {
  interface Window {
    brickly?: BricklyApi
    qrToolkitPreload?: QrToolkitPreload
  }
}

export {}

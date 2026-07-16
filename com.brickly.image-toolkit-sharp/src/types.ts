export type ActionId =
  | 'compress'
  | 'convert'
  | 'resize'
  | 'watermark'
  | 'roundedCorners'
  | 'padding'
  | 'crop'
  | 'rotate'
  | 'flip'
  | 'stripMeta'
  | 'join'
  | 'pdf'
  | 'gif'

export type ToolGroup = 'single' | 'multi'

export type CropMode = 'numeric' | 'drag'

export type OutputMode = 'sidecar' | 'dir'

export interface OutputStrategy {
  mode: OutputMode
  dir?: string
  overwrite?: boolean
}

export interface CommonOptions {
  autoOrient: boolean
  stripMetadata: boolean
}

export interface ProcessImageInput {
  action: ActionId
  files: string[]
  options: Record<string, unknown>
  output?: {
    mode?: OutputMode
    dir?: string
    overwrite?: boolean
  }
  common?: {
    autoOrient?: boolean
    stripMetadata?: boolean
  }
}

export interface ProcessItemError {
  code: string
  message: string
}

export interface ProcessItem {
  input: string
  ok: boolean
  outputPath?: string
  sizeBytes?: number
  sizeKb?: number
  width?: number | null
  height?: number | null
  format?: string | null
  /** JPEG data-URL thumbnail for UI result preview (optional) */
  previewDataUrl?: string | null
  error?: ProcessItemError
}

/** Which image is shown in the main workspace panel */
export type PreviewMode = 'input' | 'result'

export interface ProcessImageResult {
  items: ProcessItem[]
  summary: {
    total: number
    succeeded: number
    failed: number
  }
}

export interface LocalFile {
  id: string
  file: File
  absPath: string
  name: string
  size: number
  previewUrl: string
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ToastState {
  id: number
  message: string
  kind: 'success' | 'error' | 'info'
}

export interface ImageToolkitPreload {
  getPathForFile: (file: File) => string
  openFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  joinPaths?: (...args: string[]) => string
  getDirname?: (filePath: string) => string
  getBasename?: (filePath: string, ext?: string) => string
}

export interface BricklyStreamHandlers {
  onProgress?: (progress: number, message?: string) => void
  onResult?: (result: ProcessImageResult) => void
  onError?: (error: { message: string; code?: string }) => void
}

export interface BricklyHost {
  stream?: (
    commandId: string,
    input: ProcessImageInput,
    handlers: BricklyStreamHandlers,
  ) => void
  invoke?: (commandId: string, input: unknown) => Promise<unknown>
  fs?: {
    pickDirectory?: () => Promise<string | undefined>
  }
}

declare global {
  interface Window {
    brickly?: BricklyHost
    imageToolkitPreload?: ImageToolkitPreload
  }
}

export {}

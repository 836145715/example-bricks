export type DriverMode = 'off' | 'proxifier' | 'nfapi' | 'tun'

export type DriverModeCapability = {
  value: DriverMode
  label: string
  supported: boolean
  reason?: string
}

export type PlatformCapabilities = {
  platformKey: string
  goos: string
  goarch: string
  systemProxy: boolean
  installCert: boolean
  driverModes: DriverModeCapability[]
  notes?: string[]
}

export type CaptureStatus = {
  running: boolean
  port: number
  proxyUrl: string
  systemProxy: boolean
  captureTcp: boolean
  captureUdp: boolean
  driverMode: DriverMode
  maxBodyPreviewBytes: number
  sunnyVersion: string
  goVersion: string
  total: number
  dropped: number
  queueDepth: number
  lastId: number
  error?: string
  capabilities: PlatformCapabilities
}

export type SessionRow = {
  id: number
  protocol: string
  phase: string
  method?: string
  url?: string
  host?: string
  path?: string
  status?: number
  pid?: number
  process?: string
  direction?: string
  localAddress?: string
  remoteAddress?: string
  requestBytes?: number
  responseBytes?: number
  bodyBytes?: number
  durationMs?: number
  error?: string
  createdAt: number
  updatedAt: number
}

export type SessionDetail = SessionRow & {
  proto?: string
  clientIp?: string
  localAddress?: string
  remoteAddress?: string
  requestHeader?: Record<string, string>
  responseHeader?: Record<string, string>
  requestPreview?: string
  responsePreview?: string
  bodyPreview?: string
  bodyBase64?: string
}

export type DetailTab = {
  id: string
  label: string
}

export type NetCaptureApi = {
  start(options: Record<string, unknown>): Promise<CaptureStatus>
  stop(): Promise<CaptureStatus>
  status(): Promise<CaptureStatus>
  list(input: Record<string, unknown>): Promise<{ items: SessionRow[]; lastId: number; total: number; dropped: number; running: boolean }>
  detail(id: number): Promise<{ item: SessionDetail }>
  clear(): Promise<{ ok: boolean }>
  installCert(): Promise<{ ok: boolean; message?: string }>
  setSystemProxy(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }>
  subscribe(callback: (event: unknown) => void): () => void
}

declare global {
  interface Window {
    netCapture?: NetCaptureApi
  }
}

// 扩展类型：用于排序与过滤
export type SortField = 'id' | 'protocol' | 'method' | 'host' | 'size' | 'duration'
export type SortOrder = 'asc' | 'desc' | null

export type StatusFilter = 'all' | 'success' | 'redirect' | 'clientError' | 'serverError' | 'errors'

export type Status = {
  running: boolean
  port: number
  proxyUrl: string
  total: number
  maxBodyBytes: number
  certificateFingerprint: string
  pythonVersion: string
  systemProxy?: boolean
  systemProxyWarning?: string
}

export type Session = {
  id: string
  startedAt: number
  durationMs: number
  scheme: string
  httpVersion: string
  method: string
  host: string
  path: string
  url: string
  statusCode: number
  contentType: string
  requestBytes: number
  responseBytes: number
  state: string
  error?: string
  request?: Message
  response?: Message
}

export type Message = { headers: Record<string, string>; body: string; truncated?: boolean }

export type BricklyStartedHandle = {
  invoke<T = unknown>(commandId: string, input?: Record<string, unknown>): Promise<T>
  dispose(): Promise<void>
}

declare global {
  interface Window {
    brickly?: {
      invoke<T = unknown>(commandId: string, input?: Record<string, unknown>): Promise<T>
      interact?: (commandId: string, input?: Record<string, unknown>) => Promise<unknown>
      call?: (commandId: string, input?: Record<string, unknown>) => Promise<unknown>
      start(): Promise<BricklyStartedHandle>
      events: {
        subscribe(event: string, listener: (envelope: unknown) => void): Promise<() => Promise<void>>
      }
    }
  }
}

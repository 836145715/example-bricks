export type Status = { running: boolean; port: number; proxyUrl: string; total: number; maxBodyBytes: number; certificateFingerprint: string; pythonVersion: string; systemProxy?: boolean; systemProxyWarning?: string }
export type Session = { id: string; startedAt: number; durationMs: number; scheme: string; httpVersion: string; method: string; host: string; path: string; url: string; statusCode: number; contentType: string; requestBytes: number; responseBytes: number; state: string; error?: string; request?: Message; response?: Message }
export type Message = { headers: Record<string, string>; body: string; truncated?: boolean }
export type InspectorApi = { invoke<T>(commandId: string, input?: Record<string, unknown>): Promise<T>; subscribe(callback: () => void): () => void }

declare global { interface Window { httpInspector?: InspectorApi } }

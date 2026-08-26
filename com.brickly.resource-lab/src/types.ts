export type TestGroup = 'create' | 'read' | 'cross-language' | 'lifecycle' | 'stress'
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled' | 'waiting-restart'
export type RunStatus = 'running' | 'passed' | 'failed' | 'cancelled' | 'waiting-restart'

export interface ScenarioDefinition {
  id: string
  group: TestGroup
  title: string
  mode: 'default' | 'stress' | 'manual'
  exclusive: boolean
  target?: string
  sizeBytes?: number
  requirements?: string[]
}

export interface TestError {
  code: string
  message: string
}

export interface TestResult {
  runId: string
  scenarioId: string
  group: TestGroup
  title: string
  target?: string
  sizeBytes?: number
  exclusive: boolean
  status: TestStatus
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  throughputBytesPerSecond?: number
  sha256?: string
  chunkCount?: number
  hops?: string[]
  skipReason?: string
  checkpoint?: unknown
  error?: TestError
  resource?: Record<string, unknown>
  [key: string]: unknown
}

export interface RunSnapshot {
  runId: string
  mode: string
  status: RunStatus
  startedAt: number
  finishedAt?: number
  results: TestResult[]
}

export interface SuiteCatalog {
  groups: TestGroup[]
  scenarios: ScenarioDefinition[]
}

export interface StatusCounts {
  total: number
  passed: number
  failed: number
  skipped: number
  cancelled: number
  running: number
  pending: number
  waitingRestart: number
}

export interface RendererResourceHandle {
  ref?: { sizeBytes?: number; mimeType?: string; name?: string }
  json<T = unknown>(): Promise<T>
  text(): Promise<string>
  close(): Promise<void>
  revoke?(): Promise<void>
}

export interface RendererResourceRef {
  kind: 'brickly.resource'
  resourceId: string
  /** Host Catalog grant 是唯一授权，token 已不再作为必填。 */
  accessToken?: string
  sizeBytes: number
  sha256: string
  expiresAt: number
  mimeType?: string
  name?: string
}

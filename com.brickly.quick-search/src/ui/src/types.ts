/**
 * 搜索消费方可见的协议投影。
 * 与宿主 contracts/quick-search.ts 的 QuickSearch* 形态一致（消费通道无字段裁剪），
 * 与 SDK SearchQueryResultItem 的差异：消费方实际还能拿到 presentation / rootDir，
 * SDK 类型声明偏窄，这里按线上真实 payload 建模。
 */

export interface SearchResultAction {
  id: string
  title: string
  icon?: string
  destructive?: boolean
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface SearchPresentation {
  variant?: 'default' | 'file' | 'app' | 'command' | 'shortcut' | 'quick-launch'
  badge?: string
  badgeTone?: BadgeTone
  metadata?: { label: string; value: string }[]
  accentColor?: string
}

export interface SearchResult {
  id: string
  brickId?: string
  origin?: string
  version?: string
  kind: string
  category?: string
  providerId?: string
  providerLabel?: string
  title: string
  subtitle?: string
  accessory?: string
  commandId?: string
  icon?: string
  /** Provider 砖根目录（icon 相对路径拼 file:// 用）。 */
  rootDir?: string
  score?: number
  requiresInput?: boolean
  activatable?: boolean
  actions?: SearchResultAction[]
  disabled?: boolean
  reason?: string
  presentation?: SearchPresentation
}

export interface ProviderState {
  providerId: string
  providerLabel: string
  category?: string
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped' | 'disabled' | 'unavailable'
  resultCount: number
  message?: string
}

export interface SearchSnapshot {
  query: string
  sequence?: number
  results: SearchResult[]
  providerStates: ProviderState[]
  complete: boolean
  generatedAt: number
  /** runtime 侧调用本身失败（区别于 provider 级失败，后者在 providerStates 里）。 */
  error?: string
}

export interface ActivationResult {
  resultId: string
  action: 'opened-brick' | 'invoked-command' | 'activated-provider-result'
  message?: string
  resultPreview?: string
}

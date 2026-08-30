import type { HealthReason, HealthStatus } from './types'

export const EVERYTHING_DOWNLOAD_URL = 'https://www.voidtools.com/zh-cn/downloads/'

function isHealthShape(value: unknown): value is HealthStatus {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return 'ipcReady' in obj || 'reason' in obj || 'dllPath' in obj || 'dllExists' in obj
}

export function unwrapHealth(raw: unknown): HealthStatus {
  if (isHealthShape(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (isHealthShape(obj.status)) return obj.status
    if (isHealthShape(obj.value)) return obj.value
    if (isHealthShape(obj.data)) return obj.data
  }
  throw new Error('健康检查返回格式无效')
}

export function healthReason(health: HealthStatus | null): HealthReason | null {
  if (!health) return null
  if (health.reason && health.reason !== 'ready') return health.reason
  if (health.reason === 'ready' || (health.ok === true && health.ipcReady === true)) return 'ready'
  if (health.ipcConnected && !health.ipcReady) return 'indexing'
  if (health.processRunning && !health.ipcReady) return 'ipc_unavailable'
  if (health.installPath && !health.ipcReady) return 'not_running'
  if (health.ok === false || health.ipcReady === false) return 'indexing'
  return null
}

export function isIndexReady(health: HealthStatus | null): boolean {
  return healthReason(health) === 'ready'
}

export function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return ''
  return String((error as { code?: unknown }).code || '')
}

export function indexErrorReason(error: unknown): HealthReason | null {
  switch (errorCode(error)) {
    case 'EVERYTHING_INDEXING':
      return 'indexing'
    case 'EVERYTHING_NOT_RUNNING':
      return 'not_running'
    case 'EVERYTHING_IPC_UNAVAILABLE':
      return 'ipc_unavailable'
    case 'EVERYTHING_NOT_INSTALLED':
      return 'not_installed'
    default:
      break
  }
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '')
  if (message.includes('正在建立索引')) return 'indexing'
  if (message.includes('正在后台启动')) return 'not_running'
  if (message.includes('尚未接通')) return 'ipc_unavailable'
  return null
}

export function blockedHealth(current: HealthStatus | null, reason: HealthReason, message: string): HealthStatus {
  return {
    ok: false,
    reason,
    platform: current?.platform || '',
    architecture: current?.architecture || '',
    goVersion: current?.goVersion || '',
    buildStamp: current?.buildStamp || '',
    dllPath: current?.dllPath || '',
    dllExists: current?.dllExists ?? true,
    dllLoaded: current?.dllLoaded ?? true,
    ipcReady: false,
    ipcConnected: reason === 'indexing' ? true : current?.ipcConnected,
    processRunning: reason === 'not_running' || reason === 'ipc_unavailable' || reason === 'indexing' || current?.processRunning,
    installPath: current?.installPath,
    downloadUrl: current?.downloadUrl,
    everythingError: message,
    checkedAt: Date.now()
  }
}

export function healthStatusLabel(health: HealthStatus | null): string {
  switch (healthReason(health)) {
    case 'ready':
      return '索引可用'
    case 'not_installed':
      return '捆绑组件缺失'
    case 'not_running':
      return '正在启动 Everything'
    case 'indexing':
      return '正在建立索引'
    case 'ipc_unavailable':
      return '正在接通索引'
    case 'missing_sdk':
      return '组件缺失'
    case 'unsupported':
      return '仅支持 Windows'
    default:
      return health ? '索引未就绪' : '检查索引'
  }
}

export function setupCopy(health: HealthStatus | null): {
  title: string
  description: string
  steps: string[]
} {
  switch (healthReason(health)) {
    case 'not_running':
      return {
        title: '正在启动 Everything',
        description: '工具会以后台实例启动自带的 Everything，不依赖本机是否另外安装。',
        steps: []
      }
    case 'indexing':
      return {
        title: '正在建立索引',
        description: '自带 Everything 已连接，首次全盘索引完成后会自动显示结果。',
        steps: []
      }
    case 'ipc_unavailable':
      return {
        title: '正在接通索引',
        description: '自带 Everything 已启动，索引通道还没接通，请稍候。',
        steps: []
      }
    case 'missing_sdk':
      return {
        title: '搜索组件不完整',
        description: '工具自带的 Everything SDK 缺失或无法加载，需要重新安装本工具。',
        steps: ['从市场或开发工作区重新安装本地搜索', '安装完成后重新打开本窗口']
      }
    case 'unsupported':
      return {
        title: '当前系统不受支持',
        description: '本地搜索第一版只支持 Windows x64，并依赖 Everything 客户端。',
        steps: []
      }
    default:
      return {
        title: '捆绑的 Everything 缺失',
        description: '本工具自带 runtime/win-x64 下的 Everything 客户端。文件缺失时请重新安装本工具。',
        steps: ['从市场或开发工作区重新安装本地搜索', '安装完成后重新打开本窗口']
      }
  }
}

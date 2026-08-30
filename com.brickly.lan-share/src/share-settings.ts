import type { ShareConfigInput, ShareStatus } from './types'

const SETTINGS_KEY = 'brickly.lan-share.settings.v1'

export interface ShareSettings {
  root: string
  port: number
  allowUpload: boolean
  hasAccessCode: boolean
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const DEFAULT_SETTINGS: ShareSettings = {
  root: '',
  port: 8723,
  allowUpload: false,
  hasAccessCode: false
}

export function loadShareSettings(storage: StorageLike): ShareSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<ShareSettings>
    return {
      root: typeof parsed.root === 'string' ? parsed.root : '',
      port: validPort(parsed.port) ? parsed.port : DEFAULT_SETTINGS.port,
      allowUpload:
        typeof parsed.allowUpload === 'boolean' ? parsed.allowUpload : DEFAULT_SETTINGS.allowUpload,
      hasAccessCode:
        typeof parsed.hasAccessCode === 'boolean'
          ? parsed.hasAccessCode
          : DEFAULT_SETTINGS.hasAccessCode
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveShareSettings(
  storage: StorageLike,
  config: ShareConfigInput,
  hasAccessCode: boolean
): ShareSettings {
  const settings: ShareSettings = {
    root: typeof config.root === 'string' ? config.root.trim() : '',
    port: validPort(config.port) ? config.port : DEFAULT_SETTINGS.port,
    allowUpload: Boolean(config.allowUpload),
    hasAccessCode
  }
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  return settings
}

export function toRuntimeConfig(
  config: ShareConfigInput,
  hasAccessCode: boolean
): ShareConfigInput {
  const runtimeConfig: ShareConfigInput = {
    root: typeof config.root === 'string' ? config.root.trim() : undefined,
    port: config.port,
    allowUpload: config.allowUpload
  }
  const accessCode = typeof config.accessCode === 'string' ? config.accessCode.trim() : ''
  if (accessCode) {
    runtimeConfig.accessCode = accessCode
  } else if (!hasAccessCode) {
    runtimeConfig.accessCode = ''
  }
  return runtimeConfig
}

export function createStoppedStatus(settings: ShareSettings): ShareStatus {
  return {
    running: false,
    root: settings.root,
    port: settings.port,
    allowUpload: settings.allowUpload,
    hasAccessCode: settings.hasAccessCode,
    startedAt: 0,
    urls: [],
    log: []
  }
}

function validPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535
}

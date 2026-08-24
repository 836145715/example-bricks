/** 纯 UI 体验窗入口。只使用 getManifest / closeWindow / system / log，不调用 invoke/start。 */

export function canUseBrickly(): boolean {
  return typeof window.brickly?.getManifest === 'function'
}

export function closeExperienceWindow(): void {
  window.brickly?.closeWindow()
}

export async function readExperienceManifest(): Promise<{
  id?: string
  version?: string
  name?: unknown
} | null> {
  if (!canUseBrickly()) return null
  try {
    const raw = await window.brickly.getManifest()
    if (!raw || typeof raw !== 'object') return null
    return raw as { id?: string; version?: string; name?: unknown }
  } catch {
    return null
  }
}

export function localizeManifestName(name: unknown, fallback: string): string {
  if (typeof name === 'string' && name.trim()) return name
  if (name && typeof name === 'object') {
    const record = name as Record<string, string>
    return record['zh-CN'] || record.en || fallback
  }
  return fallback
}

export function bricklyLog(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  window.brickly?.log[level](message, detail)
}

export async function bricklyIsDev(): Promise<boolean> {
  if (!canUseBrickly()) return false
  try {
    return Boolean(await window.brickly.system.isDev())
  } catch {
    return false
  }
}

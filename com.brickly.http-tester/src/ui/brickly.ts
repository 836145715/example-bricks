import type { SendInput, SendResult } from './types'

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

export async function sendRequest(input: SendInput): Promise<SendResult> {
  return requireBrickly().invoke<SendResult>('send', { ...input } as Record<string, unknown>)
}

export function isBricklyAvailable(): boolean {
  return Boolean(window.brickly && typeof window.brickly.invoke === 'function')
}

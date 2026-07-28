import type { ProbeResult, ProcessDetails, StopResult } from './types'

const PROBE_TIMEOUT_MS = 25_000
const DEFAULT_TIMEOUT_MS = 15_000

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

function requirePreload() {
  if (!window.holdProbePreload) {
    throw new Error('holdProbePreload 不可用，请确认 preload 已加载。')
  }
  return window.holdProbePreload
}

async function invokeWithTimeout<T>(
  commandId: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const brickly = requireBrickly()
  console.info(`[hold-probe] invoke ${commandId}`, input)

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      brickly.invoke(commandId, input) as Promise<T>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `命令 ${commandId} 超时（${Math.round(timeoutMs / 1000)}s）。runtime 可能卡住或未正确加载，请重载 Brick 后重试。`,
            ),
          )
        }, timeoutMs)
      }),
    ])
    console.info(`[hold-probe] invoke ${commandId} ok`, result)
    return result
  } catch (error) {
    console.error(`[hold-probe] invoke ${commandId} failed`, error)
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function probePath(path: string, deep: boolean): Promise<ProbeResult> {
  return invokeWithTimeout<ProbeResult>('probe', { path, deep }, deep ? 30_000 : PROBE_TIMEOUT_MS)
}

export async function fetchProcessInfo(pid: number, startKey: string): Promise<ProcessDetails> {
  return invokeWithTimeout<ProcessDetails>('process-info', { pid, startKey }, DEFAULT_TIMEOUT_MS)
}

export async function stopProcess(pid: number, startKey: string, force: boolean): Promise<StopResult> {
  return invokeWithTimeout<StopResult>('stop', { pid, startKey, force }, DEFAULT_TIMEOUT_MS)
}

export async function pickFile(): Promise<string | undefined> {
  return requirePreload().pickFile()
}

export async function pickDirectory(): Promise<string | undefined> {
  return requirePreload().pickDirectory()
}

export function getPathForFile(file: File): string {
  return requirePreload().getPathForFile(file)
}

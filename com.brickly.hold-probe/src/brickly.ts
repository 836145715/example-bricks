import type { Holder, ProbeResult, ProcessDetails, StopResult } from './types'

const PROBE_TIMEOUT_MS = 25_000
const DEFAULT_TIMEOUT_MS = 15_000

const MOCK_HOLDERS: Holder[] = [
  {
    pid: 14280,
    startKey: '14280-mock-key-01',
    processName: 'node.exe',
    applicationType: 'Service',
    status: 1,
    restartable: true,
    sessionId: 1,
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    sources: ['restart-manager', 'handle-scan']
  },
  {
    pid: 8912,
    startKey: '8912-mock-key-02',
    processName: 'Code.exe',
    applicationType: 'MainWindow',
    status: 1,
    restartable: false,
    sessionId: 1,
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    sources: ['restart-manager']
  },
  {
    pid: 2404,
    startKey: '2404-mock-key-03',
    processName: 'cmd.exe',
    applicationType: 'Console',
    status: 1,
    restartable: true,
    sessionId: 1,
    startedAt: new Date(Date.now() - 10800000).toISOString(),
    sources: ['handle-scan', 'process-ref']
  }
]

function isDevEnvironment(): boolean {
  return !window.brickly || typeof window.brickly.invoke !== 'function'
}

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

function requirePreload() {
  if (!window.holdProbePreload) {
    if (isDevEnvironment()) {
      return {
        pickFile: async () => 'D:\\brick-project\\example-bricks\\com.brickly.hold-probe\\package.json',
        pickDirectory: async () => 'D:\\brick-project\\example-bricks\\com.brickly.hold-probe',
        getPathForFile: (file: File) => file.name
      }
    }
    throw new Error('holdProbePreload 不可用，请确认 preload 已加载。')
  }
  return window.holdProbePreload
}

async function invokeWithTimeout<T>(
  commandId: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  if (isDevEnvironment()) {
    console.info(`[hold-probe mock] invoke ${commandId}`, input)
    await new Promise((r) => setTimeout(r, 400))

    if (commandId === 'probe') {
      const targetPath = String(input.path || '')
      return {
        path: targetPath,
        kind: targetPath.includes('.') ? 'file' : 'directory',
        count: MOCK_HOLDERS.length,
        holders: MOCK_HOLDERS,
        deepUsed: Boolean(input.deep),
        notes: input.deep ? ['句柄扫描完成，模拟模式包含 3 个进程占用'] : [],
        probedAt: new Date().toISOString()
      } as unknown as T
    }

    if (commandId === 'process-info') {
      const pid = Number(input.pid || 0)
      const found = MOCK_HOLDERS.find((h) => h.pid === pid)
      return {
        pid,
        startKey: String(input.startKey || ''),
        processName: found?.processName || 'node.exe',
        executablePath: `C:\\Program Files\\nodejs\\${found?.processName || 'node.exe'}`,
        commandLine: `"C:\\Program Files\\nodejs\\node.exe" "d:\\brick-project\\com.brickly.hold-probe\\dev.js"`,
        user: 'NT AUTHORITY\\SYSTEM',
        parentPid: 916,
        sessionId: 1,
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        inspectedAt: new Date().toISOString()
      } as unknown as T
    }

    if (commandId === 'stop') {
      return {
        ok: true,
        pid: Number(input.pid || 0),
        startKey: String(input.startKey || ''),
        processName: 'mock.exe',
        force: Boolean(input.force),
        alreadyExited: false,
        stoppedAt: new Date().toISOString()
      } as unknown as T
    }
  }

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

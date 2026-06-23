import type { KillProcessResult, PortQueryResult, ProcessDetails, ProtocolFilter } from './types'

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

export async function lookupPort(port: number, protocol: ProtocolFilter): Promise<PortQueryResult> {
  return requireBrickly().invoke('lookup', { port, protocol }) as Promise<PortQueryResult>
}

export async function listPorts(input: {
  query: string
  protocol: ProtocolFilter
  includeEstablished: boolean
  limit: number
}): Promise<PortQueryResult> {
  return requireBrickly().invoke('list', input) as Promise<PortQueryResult>
}

export async function killProcess(pid: number, force: boolean): Promise<KillProcessResult> {
  return requireBrickly().invoke('kill', { pid, force }) as Promise<KillProcessResult>
}

export async function getProcessDetails(pid: number): Promise<ProcessDetails> {
  return requireBrickly().invoke('details', { pid }) as Promise<ProcessDetails>
}

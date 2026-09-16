import type { DnsServerSelection, RecordType, ResolveAllResult, ResolveResult } from './types'

function requireBrickly() {
  if (!window.brickly || typeof window.brickly.invoke !== 'function') {
    throw new Error('window.brickly.invoke 不可用，请在 Brickly Webview 中打开本工具。')
  }
  return window.brickly
}

export async function resolveDomain(
  domain: string,
  recordType: RecordType,
  dnsServers: DnsServerSelection
): Promise<ResolveResult> {
  return requireBrickly().invoke<ResolveResult>('resolve', { domain, recordType, dnsServers })
}

export async function resolveAllRecords(
  domain: string,
  dnsServers: DnsServerSelection
): Promise<ResolveAllResult> {
  return requireBrickly().invoke<ResolveAllResult>('resolve-all', { domain, dnsServers })
}

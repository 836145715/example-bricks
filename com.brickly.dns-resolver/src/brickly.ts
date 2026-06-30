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
  return requireBrickly().invoke('resolve', { domain, recordType, dnsServers }) as Promise<ResolveResult>
}

export async function resolveAllRecords(
  domain: string,
  dnsServers: DnsServerSelection
): Promise<ResolveAllResult> {
  return requireBrickly().invoke('resolve-all', { domain, dnsServers }) as Promise<ResolveAllResult>
}

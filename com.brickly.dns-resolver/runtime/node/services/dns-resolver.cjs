/* eslint-disable */
'use strict'

const dns = require('node:dns').promises
const os = require('node:os')
const https = require('node:https')
const { BppError } = require('@syllm/brickly-sdk')

const DNS_SERVERS = {
  google: { label: 'Google Public DNS', address: '8.8.8.8', doh: 'https://dns.google/resolve' },
  cloudflare: { label: 'Cloudflare DNS', address: '1.1.1.1', doh: 'https://cloudflare-dns.com/dns-query' },
  ali: { label: 'AliDNS', address: '223.5.5.5', doh: 'https://dns.alidns.com/resolve' },
  tencent: { label: 'DNSPod', address: '119.29.29.29', doh: 'https://doh.pub/dns-query' },
  system: { label: 'System Default', address: null, doh: null }
}

const ALL_RECORD_TYPES = ['a', 'aaaa', 'cname', 'mx', 'ns', 'txt']
const VALID_RECORD_TYPES = new Set([...ALL_RECORD_TYPES, 'any'])

const DNS_TIMEOUT_MS = 10000

function normalizeDomain(value) {
  if (typeof value !== 'string') {
    throw new BppError('INVALID_INPUT', 'domain must be a string')
  }
  const domain = value.trim().toLowerCase()
  if (!domain) {
    throw new BppError('INVALID_INPUT', 'domain must not be empty')
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    throw new BppError('INVALID_INPUT', `invalid domain format: ${domain}`)
  }
  return domain
}

function normalizeRecordType(value) {
  const type = String(value || 'a').trim().toLowerCase()
  if (!VALID_RECORD_TYPES.has(type)) {
    throw new BppError('INVALID_INPUT', `recordType must be one of: ${[...ALL_RECORD_TYPES, 'any'].join(', ')}`)
  }
  return type
}

function getServerList(selection) {
  if (selection === 'auto') {
    return Object.entries(DNS_SERVERS).map(([key, info]) => ({ key, ...info }))
  }
  if (DNS_SERVERS[selection]) {
    return [{ key: selection, ...DNS_SERVERS[selection] }]
  }
  throw new BppError('INVALID_INPUT', `dnsServers must be one of: auto, ${Object.keys(DNS_SERVERS).join(', ')}`)
}

function makeResolver(serverInfo) {
  if (serverInfo.address) {
    const resolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS })
    resolver.setServers([serverInfo.address])
    return resolver
  }
  const sysResolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS })
  return sysResolver
}

function dohFetch(url, params) {
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`
  return new Promise((resolve, reject) => {
    const req = https.get(fullUrl, {
      headers: { 'Accept': 'application/dns-json' },
      timeout: DNS_TIMEOUT_MS
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error(`DoH parse error: ${e.message}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('DoH request timeout'))
    })
  })
}

function parseDohAnswer(data, recordType) {
  if (!data || !data.Answer) return []
  const upperType = recordType.toUpperCase()
  const typeMap = { a: 1, aaaa: 28, cname: 5, mx: 15, ns: 2, txt: 16 }
  const targetCode = typeMap[recordType]
  if (!targetCode) return []

  return data.Answer.filter((a) => a.type === targetCode).map((a) => {
    if (recordType === 'a' || recordType === 'aaaa') {
      return { type: upperType, address: a.data, ttl: a.TTL }
    }
    if (recordType === 'cname') {
      return { type: upperType, value: a.data }
    }
    if (recordType === 'mx') {
      const parts = String(a.data).split(' ')
      return { type: upperType, priority: parseInt(parts[0], 10) || 0, exchange: parts[1] || a.data }
    }
    if (recordType === 'ns') {
      return { type: upperType, value: a.data }
    }
    if (recordType === 'txt') {
      return { type: upperType, value: String(a.data).replace(/^"|"$/g, '') }
    }
    return { type: upperType, value: String(a.data) }
  })
}

async function resolveWithDoh(domain, recordType, serverInfo) {
  const upperType = recordType.toUpperCase()
  const startedAt = Date.now()

  const data = await dohFetch(serverInfo.doh, {
    name: domain,
    type: upperType
  })

  const records = parseDohAnswer(data, recordType)
  const elapsedMs = Date.now() - startedAt

  return {
    serverKey: serverInfo.key,
    serverLabel: serverInfo.label,
    serverAddress: `${serverInfo.address || 'system'} (DoH)`,
    recordType: upperType,
    records,
    recordCount: records.length,
    elapsedMs,
    ok: true,
    error: null
  }
}

async function resolveWithUdp(domain, recordType, serverInfo) {
  const resolver = makeResolver(serverInfo)
  const upperType = recordType.toUpperCase()
  const startedAt = Date.now()

  let records = []
  if (recordType === 'a') {
    records = await resolver.resolve4(domain, { ttl: true })
  } else if (recordType === 'aaaa') {
    records = await resolver.resolve6(domain, { ttl: true })
  } else if (recordType === 'cname') {
    records = await resolver.resolveCname(domain)
  } else if (recordType === 'mx') {
    records = await resolver.resolveMx(domain)
  } else if (recordType === 'ns') {
    records = await resolver.resolveNs(domain)
  } else if (recordType === 'txt') {
    records = await resolver.resolveTxt(domain)
  } else {
    throw new BppError('INVALID_INPUT', `unsupported record type: ${recordType}`)
  }

  const elapsedMs = Date.now() - startedAt
  return {
    serverKey: serverInfo.key,
    serverLabel: serverInfo.label,
    serverAddress: `${serverInfo.address || 'system'} (UDP)`,
    recordType: upperType,
    records: records.map((record) => formatRecord(record, upperType)),
    recordCount: records.length,
    elapsedMs,
    ok: true,
    error: null
  }
}

async function resolveWithServer(domain, recordType, serverInfo) {
  const upperType = recordType.toUpperCase()
  const startedAt = Date.now()

  // 优先使用 DoH（绕过 Clash TUN 对 UDP 53 的拦截）
  if (serverInfo.doh) {
    try {
      return await resolveWithDoh(domain, recordType, serverInfo)
    } catch (dohError) {
      console.error(`[dns-resolver] DoH failed for ${serverInfo.key}: ${dohError.message}, falling back to UDP`)
    }
  }

  // Fallback: 传统 UDP DNS
  try {
    return await resolveWithUdp(domain, recordType, serverInfo)
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    const errorDetail = {
      serverKey: serverInfo.key,
      serverLabel: serverInfo.label,
      serverAddress: serverInfo.address || 'system',
      recordType: upperType,
      domain,
      errorCode: error.code || null,
      errorMessage: error.message || String(error),
      errorStack: error.stack || null,
      elapsedMs
    }
    console.error('[dns-resolver] resolve failed:', JSON.stringify(errorDetail, null, 2))
    return {
      serverKey: serverInfo.key,
      serverLabel: serverInfo.label,
      serverAddress: serverInfo.address || 'system',
      recordType: upperType,
      records: [],
      recordCount: 0,
      elapsedMs,
      ok: false,
      error: `${error.code || 'ERROR'}: ${error.message || String(error)}`
    }
  }
}

function formatRecord(record, type) {
  if (type === 'A' || type === 'AAAA') {
    return {
      type,
      address: record.address,
      ttl: record.ttl
    }
  }
  if (type === 'CNAME') {
    return {
      type,
      value: record
    }
  }
  if (type === 'MX') {
    return {
      type,
      priority: record.priority,
      exchange: record.exchange
    }
  }
  if (type === 'NS') {
    return {
      type,
      value: record
    }
  }
  if (type === 'TXT') {
    return {
      type,
      value: Array.isArray(record) ? record.join('') : String(record)
    }
  }
  return { type, value: String(record) }
}

async function resolveDomain(input) {
  const domain = normalizeDomain(input.domain)
  const recordType = normalizeRecordType(input.recordType)
  const servers = getServerList(input.dnsServers || 'auto')

  const results = await Promise.all(
    servers.map((server) => resolveWithServer(domain, recordType, server))
  )

  const allRecords = results.flatMap((r) => r.records)
  const uniqueIps = [...new Set(
    allRecords
      .filter((r) => r.type === 'A' || r.type === 'AAAA')
      .map((r) => r.address)
  )]

  return {
    domain,
    recordType: recordType.toUpperCase(),
    serverSelection: input.dnsServers || 'auto',
    serverCount: servers.length,
    results,
    uniqueIps,
    uniqueIpCount: uniqueIps.length,
    totalRecords: allRecords.length,
    generatedAt: new Date().toISOString()
  }
}

async function resolveAllRecords(input) {
  const domain = normalizeDomain(input.domain)
  const servers = getServerList(input.dnsServers || 'auto')

  const tasks = []
  for (const server of servers) {
    for (const type of ALL_RECORD_TYPES) {
      tasks.push(resolveWithServer(domain, type, server))
    }
  }

  const allResults = await Promise.all(tasks)

  const byType = {}
  for (const type of ALL_RECORD_TYPES) {
    byType[type.toUpperCase()] = allResults.filter((r) => r.recordType === type.toUpperCase())
  }

  const allRecords = allResults.flatMap((r) => r.records)
  const uniqueIps = [...new Set(
    allRecords
      .filter((r) => r.type === 'A' || r.type === 'AAAA')
      .map((r) => r.address)
  )]

  return {
    domain,
    serverSelection: input.dnsServers || 'auto',
    serverCount: servers.length,
    byType,
    uniqueIps,
    uniqueIpCount: uniqueIps.length,
    totalRecords: allRecords.length,
    generatedAt: new Date().toISOString()
  }
}

function runtimeInfo() {
  return {
    platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    hostname: os.hostname(),
    dnsServers: Object.entries(DNS_SERVERS).map(([key, info]) => ({
      key,
      label: info.label,
      address: info.address || 'system'
    }))
  }
}

module.exports = {
  resolveDomain,
  resolveAllRecords,
  runtimeInfo,
  normalizeDomain,
  normalizeRecordType
}

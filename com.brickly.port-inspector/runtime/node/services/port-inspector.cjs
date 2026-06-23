/* eslint-disable */
'use strict'

const os = require('node:os')
const fs = require('node:fs/promises')
const path = require('node:path')
const { BppError } = require('@syllm/brickly-sdk')
const { runFile } = require('./process-runner.cjs')

const SUPPORTED_PROTOCOLS = new Set(['all', 'tcp', 'udp'])
const LISTENABLE_STATES = new Set(['LISTEN', 'LISTENING', ''])
const REPLACEMENT_CHARACTER = '\uFFFD'

function normalizePort(value, fieldName = 'port') {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BppError('INVALID_INPUT', `${fieldName} must be an integer between 1 and 65535`)
  }
  return port
}

function normalizePid(value, options = {}) {
  const pid = Number(value)
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new BppError('INVALID_INPUT', 'pid must be a positive integer')
  }
  if (options.forbidSelf && pid === process.pid) {
    throw new BppError('INVALID_INPUT', 'refusing to terminate the Port Inspector runtime process itself')
  }
  return pid
}

function normalizeProtocol(value) {
  const protocol = String(value || 'all').trim().toLowerCase()
  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new BppError('INVALID_INPUT', 'protocol must be one of all, tcp or udp')
  }
  return protocol
}

function normalizeLimit(value, fallback = 300) {
  const limit = Number(value)
  if (!Number.isFinite(limit)) return fallback
  return Math.max(1, Math.min(2000, Math.floor(limit)))
}

function boolValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return !['false', '0', 'no', 'off'].includes(value.toLowerCase())
  return Boolean(value)
}

function currentPlatform() {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'linux') return 'linux'
  throw new BppError('UNSUPPORTED_PLATFORM', `Unsupported platform: ${process.platform}`)
}

async function inspectPorts(input = {}) {
  const platform = currentPlatform()
  const protocol = normalizeProtocol(input.protocol)
  const includeEstablished = boolValue(input.includeEstablished, true)
  const query = String(input.query || '').trim()
  const limit = normalizeLimit(input.limit)
  const rows = await readConnections(platform)
  const baseFiltered = filterRows(rows, {
    port: input.port === undefined || input.port === null || input.port === '' ? undefined : normalizePort(input.port),
    protocol,
    includeEstablished,
    query: '',
    limit: query ? rows.length || limit : limit
  })
  const enriched = await enrichProcessNames(platform, baseFiltered)
  const finalRows = query
    ? filterRows(enriched, {
        port: undefined,
        protocol: 'all',
        includeEstablished: true,
        query,
        limit
      })
    : enriched
  return {
    platform,
    protocol,
    query,
    count: finalRows.length,
    generatedAt: new Date().toISOString(),
    rows: finalRows
  }
}

async function lookupPort(input = {}) {
  const port = normalizePort(input.port)
  return inspectPorts({
    port,
    protocol: input.protocol || 'all',
    includeEstablished: true,
    limit: input.limit || 2000
  })
}

async function killProcess(input = {}) {
  const pid = normalizePid(input.pid, { forbidSelf: true })
  const force = boolValue(input.force, false)
  const platform = currentPlatform()
  const before = await getProcessName(platform, pid)

  if (platform === 'windows') {
    const args = ['/PID', String(pid)]
    if (force) args.push('/F')
    await runFile('taskkill.exe', args, { timeoutMs: 15000 })
  } else {
    await runFile('kill', [force ? '-9' : '-15', String(pid)], { timeoutMs: 15000 })
  }

  return {
    ok: true,
    pid,
    force,
    processName: before || null,
    platform,
    killedAt: new Date().toISOString()
  }
}

async function inspectProcessDetails(input = {}) {
  const pid = normalizePid(input.pid)
  const platform = currentPlatform()
  if (platform === 'windows') return getWindowsProcessDetails(pid)
  return getUnixProcessDetails(platform, pid)
}

async function readConnections(platform) {
  if (platform === 'windows') {
    const { stdout } = await runFile('netstat.exe', ['-ano'])
    return parseWindowsNetstat(stdout)
  }
  if (platform === 'macos') {
    const { stdout } = await runFile('lsof', ['-nP', '-iTCP', '-iUDP', '-sTCP:LISTEN'])
    return parseLsof(stdout)
  }
  const { stdout } = await runFile('ss', ['-H', '-tunlp'])
  return parseSs(stdout)
}

function filterRows(rows, options) {
  const query = options.query.toLowerCase()
  const port = options.port
  const protocol = options.protocol
  const includeEstablished = options.includeEstablished

  return rows
    .filter((row) => {
      if (protocol !== 'all' && row.protocol.toLowerCase() !== protocol) return false
      if (port !== undefined && row.localPort !== port) return false
      if (!includeEstablished && !LISTENABLE_STATES.has(String(row.state || '').toUpperCase())) return false
      if (!query) return true
      const haystack = [
        row.protocol,
        row.localAddress,
        row.localPort,
        row.remoteAddress,
        row.remotePort,
        row.state,
        row.pid,
        row.processName
      ]
        .filter((item) => item !== undefined && item !== null)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
    .sort(compareRows)
    .slice(0, options.limit)
}

function compareRows(a, b) {
  if (a.localPort !== b.localPort) return a.localPort - b.localPort
  if (a.protocol !== b.protocol) return a.protocol.localeCompare(b.protocol)
  return String(a.pid || '').localeCompare(String(b.pid || ''))
}

async function enrichProcessNames(platform, rows) {
  const pidSet = new Set(rows.map((row) => row.pid).filter((pid) => Number.isInteger(pid) && pid > 0))
  const names = await getProcessNames(platform, [...pidSet])
  return rows.map((row) => ({
    ...row,
    processName: resolveProcessName(row.processName, names.get(row.pid))
  }))
}

async function getProcessNames(platform, pids) {
  if (!pids.length) return new Map()
  if (platform === 'windows') return getWindowsProcessNames(pids)
  return getUnixProcessNames(pids)
}

async function getProcessName(platform, pid) {
  const names = await getProcessNames(platform, [pid])
  return names.get(pid) || null
}

async function getWindowsProcessNames(pids) {
  const map = new Map()
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(' or ')
  try {
    const { stdout } = await runFile('wmic.exe', ['process', 'where', filter, 'get', 'ProcessId,Name', '/format:csv'])
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('Node,')) continue
      const parts = trimmed.split(',')
      const pid = Number(parts.at(-1))
      const name = parts.at(-2)
      if (Number.isInteger(pid) && name) map.set(pid, name)
    }
    if (map.size) return map
  } catch {
    // Windows 11 上 wmic 可能缺失，回退到 PowerShell。
  }

  try {
    const script = `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName | ConvertTo-Json -Compress`
    const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    const parsed = JSON.parse(stdout.trim() || '[]')
    const list = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of list) {
      const pid = Number(item.Id)
      if (Number.isInteger(pid) && item.ProcessName) map.set(pid, `${item.ProcessName}.exe`)
    }
  } catch {
    // 查询进程名失败不应影响端口占用主结果。
  }
  return map
}

async function getUnixProcessNames(pids) {
  try {
    const { stdout } = await runFile('ps', ['-p', pids.join(','), '-o', 'pid=,comm='])
    return parseUnixProcessNames(stdout)
  } catch {
    // 查询进程名失败不应影响端口占用主结果。
  }
  return new Map()
}

function parseUnixProcessNames(stdout) {
  const map = new Map()
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!match) continue
    const name = normalizeProcessName(match[2])
    if (name) map.set(Number(match[1]), name)
  }
  return map
}

function resolveProcessName(rawName, enrichedName) {
  return normalizeProcessName(enrichedName) || normalizeProcessName(rawName) || null
}

function normalizeProcessName(value) {
  const text = String(value || '').trim()
  if (!text || text.includes(REPLACEMENT_CHARACTER)) return null

  const unquoted = text.replace(/^["']|["']$/g, '')
  const appMatch = unquoted.match(/\/([^/]+)\.app(?:\/|$)/)
  if (appMatch) return appMatch[1].trim() || null

  const basename = path.posix.basename(unquoted.replace(/\\/g, '/')).trim()
  return basename || unquoted
}

async function getUnixProcessDetails(platform, pid) {
  let summary
  try {
    const { stdout } = await runFile('ps', ['-p', String(pid), '-o', 'pid=,ppid=,user=,stat=,etime=,comm='])
    summary = parseUnixProcessSummary(stdout)
  } catch (error) {
    throw new BppError('PROCESS_NOT_FOUND', `process ${pid} not found`, { cause: normalizeErrorDetail(error) })
  }
  if (!summary) throw new BppError('PROCESS_NOT_FOUND', `process ${pid} not found`)

  const [commandLine, startedAt, workingDirectory, linuxExecutablePath] = await Promise.all([
    readUnixCommandLine(platform, pid),
    readUnixStartedAt(pid),
    readUnixWorkingDirectory(platform, pid),
    platform === 'linux' ? readLinuxSymlink(`/proc/${pid}/exe`) : Promise.resolve(null)
  ])

  return createProcessDetails(platform, {
    ...summary,
    executablePath: linuxExecutablePath || summary.executablePath,
    commandLine,
    startedAt,
    workingDirectory
  })
}

function parseUnixProcessSummary(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return null

  const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/)
  if (!match) return null
  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    user: match[3],
    state: match[4],
    elapsed: match[5],
    executablePath: match[6].trim(),
    processName: normalizeProcessName(match[6])
  }
}

async function readUnixCommandLine(platform, pid) {
  if (platform === 'linux') {
    try {
      const buffer = await fs.readFile(`/proc/${pid}/cmdline`)
      const argv = buffer
        .toString('utf8')
        .split('\0')
        .map((item) => item.trim())
        .filter(Boolean)
      if (argv.length) return argv.join(' ')
    } catch {
      // Linux /proc 可能因权限或进程退出不可读，回退到 ps。
    }
  }

  try {
    const { stdout } = await runFile('ps', ['-p', String(pid), '-o', 'args='])
    return normalizeOptionalText(stdout)
  } catch {
    return null
  }
}

async function readUnixStartedAt(pid) {
  try {
    const { stdout } = await runFile('ps', ['-p', String(pid), '-o', 'lstart='])
    return normalizeOptionalText(stdout)
  } catch {
    return null
  }
}

async function readUnixWorkingDirectory(platform, pid) {
  if (platform === 'linux') return readLinuxSymlink(`/proc/${pid}/cwd`)
  if (platform !== 'macos') return null

  try {
    const { stdout } = await runFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    return parseLsofField(stdout, 'n')
  } catch {
    return null
  }
}

async function readLinuxSymlink(filePath) {
  try {
    return await fs.readlink(filePath)
  } catch {
    return null
  }
}

function parseLsofField(stdout, prefix) {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return normalizeOptionalText(line.slice(prefix.length))
  }
  return null
}

async function getWindowsProcessDetails(pid) {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    `if ($null -eq $p) { 'null'; exit 0 }`,
    `$owner = $null`,
    `try { $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction SilentlyContinue; if ($o.ReturnValue -eq 0) { if ($o.Domain) { $owner = "$($o.Domain)\\$($o.User)" } else { $owner = $o.User } } } catch {}`,
    `[pscustomobject]@{ ProcessId = $p.ProcessId; ParentProcessId = $p.ParentProcessId; Name = $p.Name; ExecutablePath = $p.ExecutablePath; CommandLine = $p.CommandLine; CreationDate = $(if ($p.CreationDate) { $p.CreationDate.ToString('o') } else { $null }); User = $owner } | ConvertTo-Json -Compress`
  ].join('; ')

  try {
    const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 15000 })
    const parsed = parseWindowsProcessDetails(stdout)
    if (!parsed) throw new BppError('PROCESS_NOT_FOUND', `process ${pid} not found`)
    return createProcessDetails('windows', parsed)
  } catch (error) {
    if (error instanceof BppError) throw error
    throw new BppError('PROCESS_NOT_FOUND', `process ${pid} not found`, { cause: normalizeErrorDetail(error) })
  }
}

function parseWindowsProcessDetails(stdout) {
  const text = normalizeOptionalText(stdout)
  if (!text || text === 'null') return null
  const parsed = JSON.parse(text)
  const item = Array.isArray(parsed) ? parsed[0] : parsed
  if (!item) return null
  const pid = Number(item.ProcessId)
  if (!Number.isInteger(pid)) return null
  return {
    pid,
    parentPid: toNullableInteger(item.ParentProcessId),
    processName: normalizeOptionalText(item.Name),
    executablePath: normalizeOptionalText(item.ExecutablePath),
    commandLine: normalizeOptionalText(item.CommandLine),
    startedAt: normalizeOptionalText(item.CreationDate),
    user: normalizeOptionalText(item.User)
  }
}

function createProcessDetails(platform, input) {
  const executablePath = normalizeOptionalText(input.executablePath)
  const commandLine = normalizeOptionalText(input.commandLine)
  const processName = resolveProcessName(input.processName, executablePath || commandLine)
  return {
    ok: true,
    platform,
    pid: input.pid,
    parentPid: toNullableInteger(input.parentPid),
    processName,
    executablePath,
    commandLine,
    workingDirectory: normalizeOptionalText(input.workingDirectory),
    user: normalizeOptionalText(input.user),
    state: normalizeOptionalText(input.state),
    startedAt: normalizeOptionalText(input.startedAt),
    elapsed: normalizeOptionalText(input.elapsed),
    inspectedAt: new Date().toISOString()
  }
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim()
  return text || null
}

function toNullableInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function normalizeErrorDetail(error) {
  if (!error || typeof error !== 'object') return String(error)
  return {
    code: error.code || null,
    message: error.message || String(error)
  }
}

function parseWindowsNetstat(stdout) {
  const rows = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!/^(TCP|UDP)\s+/i.test(trimmed)) continue
    const parts = trimmed.split(/\s+/)
    const protocol = parts[0].toLowerCase()
    if (protocol === 'tcp' && parts.length >= 5) {
      const local = parseEndpoint(parts[1])
      const remote = parseEndpoint(parts[2])
      const pid = Number(parts[4])
      rows.push(makeRow({ protocol, local, remote, state: parts[3], pid }))
    } else if (protocol === 'udp' && parts.length >= 4) {
      const local = parseEndpoint(parts[1])
      const pid = Number(parts[3])
      rows.push(makeRow({ protocol, local, remote: parseEndpoint('*:*'), state: '', pid }))
    }
  }
  return dedupeRows(rows)
}

function parseLsof(stdout) {
  const rows = []
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(TCP|UDP)\s+(.+)$/i)
    if (!match) continue
    const processName = match[1]
    const pid = Number(match[2])
    const protocol = match[3].toLowerCase()
    const name = match[4]
    const stateMatch = name.match(/\(([^)]+)\)\s*$/)
    const state = stateMatch ? stateMatch[1] : ''
    const endpointText = name.replace(/\s+\([^)]+\)\s*$/, '')
    const [localText, remoteText = '*:*'] = endpointText.split('->')
    rows.push(
      makeRow({
        protocol,
        local: parseEndpoint(localText),
        remote: parseEndpoint(remoteText),
        state,
        pid,
        processName
      })
    )
  }
  return dedupeRows(rows)
}

function parseSs(stdout) {
  const rows = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 5) continue
    const protocol = parts[0].startsWith('udp') ? 'udp' : parts[0].startsWith('tcp') ? 'tcp' : ''
    if (!protocol) continue
    const state = protocol === 'udp' ? '' : parts[1]
    const localText = protocol === 'udp' ? parts[4] : parts[4]
    const remoteText = protocol === 'udp' ? parts[5] || '*:*' : parts[5] || '*:*'
    const processText = parts.slice(6).join(' ')
    const proc = parseSsProcess(processText)
    rows.push(
      makeRow({
        protocol,
        local: parseEndpoint(localText),
        remote: parseEndpoint(remoteText),
        state,
        pid: proc.pid,
        processName: proc.processName
      })
    )
  }
  return dedupeRows(rows)
}

function parseSsProcess(value) {
  const nameMatch = value.match(/users:\(\("([^"]+)"/)
  const pidMatch = value.match(/pid=(\d+)/)
  return {
    processName: nameMatch ? nameMatch[1] : null,
    pid: pidMatch ? Number(pidMatch[1]) : null
  }
}

function parseEndpoint(value) {
  const text = String(value || '').trim()
  if (!text || text === '*') return { address: '*', port: null }
  const normalized = text.replace(/^\[|\]$/g, '')
  const lastColon = normalized.lastIndexOf(':')
  if (lastColon < 0) return { address: normalized, port: null }
  const address = normalized.slice(0, lastColon).replace(/^\[|\]$/g, '') || '*'
  const rawPort = normalized.slice(lastColon + 1)
  const port = Number(rawPort)
  return {
    address,
    port: Number.isInteger(port) ? port : null
  }
}

function makeRow(input) {
  return {
    protocol: input.protocol,
    localAddress: input.local.address,
    localPort: input.local.port,
    remoteAddress: input.remote.address,
    remotePort: input.remote.port,
    state: input.state || '',
    pid: Number.isInteger(input.pid) ? input.pid : null,
    processName: input.processName || null
  }
}

function dedupeRows(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows) {
    if (!Number.isInteger(row.localPort)) continue
    const key = [
      row.protocol,
      row.localAddress,
      row.localPort,
      row.remoteAddress,
      row.remotePort,
      row.state,
      row.pid
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result
}

function runtimeInfo() {
  return {
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release()
  }
}

module.exports = {
  inspectPorts,
  inspectProcessDetails,
  killProcess,
  lookupPort,
  parseUnixProcessNames,
  parseUnixProcessSummary,
  parseWindowsProcessDetails,
  parseLsof,
  parseSs,
  parseWindowsNetstat,
  resolveProcessName,
  runtimeInfo
}

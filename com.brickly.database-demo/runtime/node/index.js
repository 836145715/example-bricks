/* eslint-disable */
'use strict'

const fs = require('fs')
const path = require('path')
const { randomBytes } = require('crypto')

// Inline nanoid implementation (21 chars, url-safe)
const nanoid = (size = 21) => {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'
  const bytes = randomBytes(size)
  let id = ''
  for (let i = 0; i < size; i++) {
    id += alphabet[bytes[i] & 63]
  }
  return id
}

const BRICK_ID = 'com.brickly.database-demo'
const PROTOCOL_VERSION = '0.1.0'

let buffer = ''
const cancelled = new Set()
const connections = new Map()

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function log(message, details) {
  process.stderr.write(`[${BRICK_ID}] ${message}${details ? ' ' + JSON.stringify(details) : ''}\n`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultTables() {
  return {
    users: [
      { id: 1, name: 'Ada Lovelace', role: 'admin', active: true },
      { id: 2, name: 'Grace Hopper', role: 'engineer', active: true },
      { id: 3, name: 'Alan Turing', role: 'researcher', active: false },
      { id: 4, name: 'Katherine Johnson', role: 'analyst', active: true }
    ],
    orders: [
      { id: 101, userId: 1, total: 39.9, status: 'paid' },
      { id: 102, userId: 2, total: 88.5, status: 'paid' },
      { id: 103, userId: 2, total: 12.0, status: 'draft' }
    ]
  }
}

function normalizeSeed(seed) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) return defaultTables()
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) {
    if (!Array.isArray(rows)) continue
    tables[name] = rows.map((row) => (row && typeof row === 'object' ? { ...row } : { value: row }))
  }
  return Object.keys(tables).length ? tables : defaultTables()
}

function getConnection(connectionId) {
  const conn = connections.get(connectionId)
  if (!conn) {
    const error = new Error(
      `Connection not found: ${connectionId}. Run connect first in the same plugin instance.`
    )
    error.code = 'CONNECTION_NOT_FOUND'
    throw error
  }
  conn.lastUsedAt = new Date().toISOString()
  return conn
}

function parseSql(sql) {
  const text = String(sql || '')
    .trim()
    .replace(/;$/, '')
  const re =
    /^select\s+(\*|[a-zA-Z0-9_,\s]+)\s+from\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+where\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*('([^']*)'|"([^"]*)"|[^\s]+))?(?:\s+limit\s+(\d+))?$/i
  const m = text.match(re)
  if (!m) {
    const error = new Error(
      'Only simplified SELECT is supported: select * from users where role = admin limit 10'
    )
    error.code = 'INVALID_SQL'
    throw error
  }
  const columns =
    m[1].trim() === '*'
      ? ['*']
      : m[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
  const table = m[2]
  const whereColumn = m[3]
  const whereValue = m[5] ?? m[6] ?? m[4]
  const limit = m[7] ? Math.max(0, Number(m[7])) : undefined
  return { columns, table, whereColumn, whereValue, limit }
}

function executeSelect(conn, sql) {
  const parsed = parseSql(sql)
  const tableRows = conn.tables[parsed.table]
  if (!tableRows) {
    const error = new Error(
      `Unknown table: ${parsed.table}. Available: ${Object.keys(conn.tables).join(', ')}`
    )
    error.code = 'TABLE_NOT_FOUND'
    throw error
  }
  let rows = tableRows.map((row) => ({ ...row }))
  if (parsed.whereColumn) {
    rows = rows.filter((row) => String(row[parsed.whereColumn]) === String(parsed.whereValue))
  }
  if (parsed.limit !== undefined) rows = rows.slice(0, parsed.limit)
  if (parsed.columns[0] !== '*') {
    rows = rows.map((row) => Object.fromEntries(parsed.columns.map((col) => [col, row[col]])))
  }
  const columns = rows.length
    ? Object.keys(rows[0])
    : parsed.columns[0] === '*'
      ? []
      : parsed.columns
  return { rows, rowCount: rows.length, columns }
}

function toCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))]
  const esc = (value) => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((col) => esc(row[col])).join(','))
  ].join('\n')
}

async function handleConnect(id, input) {
  const database = String(input.database || 'demo')
  const connectionId = `conn_${nanoid()}`
  const tables = normalizeSeed(input.seed)
  connections.set(connectionId, {
    connectionId,
    database,
    tables,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  })
  send({ type: 'command.output', id, name: 'connectionId', value: connectionId })
  send({ type: 'command.output', id, name: 'tables', value: Object.keys(tables) })
  send({ type: 'command.output', id, name: 'status', value: 'connected' })
  return { connectionId, tables: Object.keys(tables), status: 'connected' }
}

async function handleQuery(id, input) {
  const conn = getConnection(String(input.connectionId || ''))
  const sql = String(input.sql || '')
  send({ type: 'command.progress', id, progress: 0.1, message: `connected to ${conn.database}` })
  await sleep(80)
  if (cancelled.has(id)) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })
  send({ type: 'command.progress', id, progress: 0.45, message: 'executing query' })
  const result = executeSelect(conn, sql)
  await sleep(80)
  send({ type: 'command.output', id, name: 'rows', value: result.rows })
  send({ type: 'command.output', id, name: 'rowCount', value: result.rowCount })
  send({ type: 'command.output', id, name: 'columns', value: result.columns })
  send({ type: 'command.progress', id, progress: 1, message: `${result.rowCount} rows` })
  return result
}

async function handleSaveFile(id, input) {
  const rows = Array.isArray(input.rows) ? input.rows : []
  const format = String(input.format || 'json').toLowerCase()
  if (!['json', 'csv'].includes(format)) {
    const error = new Error(`Unsupported format: ${format}`)
    error.code = 'INVALID_INPUT'
    throw error
  }
  const filePath = path.resolve(String(input.path || `database-demo-output.${format}`))
  const content = format === 'csv' ? toCsv(rows) : JSON.stringify(rows, null, 2)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, content, 'utf8')
  const bytes = Buffer.byteLength(content, 'utf8')
  send({ type: 'command.output', id, name: 'filePath', value: filePath })
  send({ type: 'command.output', id, name: 'bytes', value: bytes })
  send({ type: 'command.output', id, name: 'format', value: format })
  return { filePath, bytes, format }
}

async function handleClose(id, input) {
  const connectionId = String(input.connectionId || '')
  const closed = connections.delete(connectionId)
  const result = { closed, remaining: connections.size }
  send({ type: 'command.output', id, name: 'closed', value: closed })
  send({ type: 'command.output', id, name: 'remaining', value: connections.size })
  return result
}

async function handleInvoke(message) {
  const { id, commandId, input = {} } = message
  log('invoke start', { id, commandId, connections: connections.size })
  try {
    let result
    if (commandId === 'connect') result = await handleConnect(id, input)
    else if (commandId === 'query') result = await handleQuery(id, input)
    else if (commandId === 'save-file') result = await handleSaveFile(id, input)
    else if (commandId === 'close') result = await handleClose(id, input)
    else {
      send({
        type: 'command.error',
        id,
        error: { code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${commandId}` }
      })
      return
    }
    send({ type: 'command.result', id, result })
    log('invoke result', { id, commandId })
  } catch (error) {
    const code = error && error.code ? error.code : 'INTERNAL_ERROR'
    send({
      type: 'command.error',
      id,
      error: { code, message: error && error.message ? error.message : String(error) }
    })
    log('invoke error', { id, commandId, code })
  } finally {
    cancelled.delete(id)
    log('invoke finish', { id, commandId, connections: connections.size })
  }
}

function onMessage(message) {
  if (message.type === 'host.hello') {
    send({ type: 'runtime.ready', protocolVersion: PROTOCOL_VERSION, brickId: BRICK_ID })
  } else if (message.type === 'runtime.ping') {
    send({ type: 'runtime.pong', id: message.id })
  } else if (message.type === 'command.cancel') {
    cancelled.add(message.id)
  } else if (message.type === 'command.invoke') {
    void handleInvoke(message)
  } else if (message.type === 'runtime.shutdown') {
    connections.clear()
    send({ type: 'runtime.bye' })
    process.exit(0)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      onMessage(JSON.parse(line))
    } catch (error) {
      send({
        type: 'command.error',
        id: 'unknown',
        error: { code: 'PROTOCOL_ERROR', message: error.message }
      })
    }
  }
})

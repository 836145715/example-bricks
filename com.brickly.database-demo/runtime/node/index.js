/* eslint-disable */
'use strict'

const fs = require('fs')
const path = require('path')
const { randomBytes } = require('crypto')
const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

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
const brick = new BricklyRuntime({ brickId: BRICK_ID })
const connections = new Map()

function log(message, details) {
  brick.log.info(message, details)
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
    throw new BppError(
      'INTERNAL_ERROR',
      `Connection not found: ${connectionId}. Run connect first in the same plugin instance.`
    )
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
    throw new BppError(
      'INVALID_INPUT',
      'Only simplified SELECT is supported: select * from users where role = admin limit 10'
    )
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
    throw new BppError(
      'INVALID_INPUT',
      `Unknown table: ${parsed.table}. Available: ${Object.keys(conn.tables).join(', ')}`
    )
  }
  let rows = tableRows.map((row) => ({ ...row }))
  if (parsed.whereColumn) {
    rows = rows.filter((row) => String(row[parsed.whereColumn]) === String(parsed.whereValue))
  }
  if (parsed.limit !== undefined) rows = rows.slice(0, parsed.limit)
  if (parsed.columns[0] !== '*') {
    rows = rows.map((row) => Object.fromEntries(parsed.columns.map((col) => [col, row[col]])))
  }
  const columns = rows.length ? Object.keys(rows[0]) : parsed.columns[0] === '*' ? [] : parsed.columns
  return { rows, rowCount: rows.length, columns }
}

function toCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))]
  const esc = (value) => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((row) => columns.map((col) => esc(row[col])).join(','))].join(
    '\n'
  )
}

async function handleConnect(ctx, input) {
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
  ctx.output('connectionId', connectionId)
  ctx.output('tables', Object.keys(tables))
  ctx.output('status', 'connected')
  return { connectionId, tables: Object.keys(tables), status: 'connected' }
}

async function handleQuery(ctx, input) {
  const conn = getConnection(String(input.connectionId || ''))
  const sql = String(input.sql || '')
  ctx.progress(0.1, `connected to ${conn.database}`)
  await sleep(80)
  if (ctx.isCancelled()) throw new BppError('CANCELLED', 'Cancelled')
  ctx.progress(0.45, 'executing query')
  const result = executeSelect(conn, sql)
  await sleep(80)
  ctx.output('rows', result.rows)
  ctx.output('rowCount', result.rowCount)
  ctx.output('columns', result.columns)
  ctx.progress(1, `${result.rowCount} rows`)
  return result
}

async function handleSaveFile(ctx, input) {
  const rows = Array.isArray(input.rows) ? input.rows : []
  const format = String(input.format || 'json').toLowerCase()
  if (!['json', 'csv'].includes(format)) {
    throw new BppError('INVALID_INPUT', `Unsupported format: ${format}`)
  }
  const filePath = path.resolve(String(input.path || `database-demo-output.${format}`))
  const content = format === 'csv' ? toCsv(rows) : JSON.stringify(rows, null, 2)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, content, 'utf8')
  const bytes = Buffer.byteLength(content, 'utf8')
  ctx.output('filePath', filePath)
  ctx.output('bytes', bytes)
  ctx.output('format', format)
  return { filePath, bytes, format }
}

async function handleClose(ctx, input) {
  const connectionId = String(input.connectionId || '')
  const closed = connections.delete(connectionId)
  const result = { closed, remaining: connections.size }
  ctx.output('closed', closed)
  ctx.output('remaining', connections.size)
  return result
}

function register(commandId, handler) {
  brick.onCommand(commandId, async (ctx, input = {}) => {
    log('invoke start', { id: ctx.requestId, commandId, connections: connections.size })
    try {
      const result = await handler(ctx, input)
      log('invoke result', { id: ctx.requestId, commandId })
      return result
    } finally {
      log('invoke finish', { id: ctx.requestId, commandId, connections: connections.size })
    }
  })
}

register('connect', handleConnect)
register('query', handleQuery)
register('save-file', handleSaveFile)
register('close', handleClose)

brick.onShutdown(() => {
  connections.clear()
})

brick.start()

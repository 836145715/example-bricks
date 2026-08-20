/* eslint-disable */
'use strict'

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { BricklyRuntime } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.system-api-lab'
const DOC_URL = 'https://www.u-tools.cn/docs/developer/utools-api/system.html'
const PATH_NAMES = [
  'home',
  'appData',
  'assets',
  'userData',
  'sessionData',
  'temp',
  'exe',
  'module',
  'desktop',
  'documents',
  'downloads',
  'music',
  'pictures',
  'videos',
  'recent',
  'logs',
  'crashDumps'
]

const brick = new BricklyRuntime({ brickId: BRICK_ID })

function bool(input, key, fallback) {
  if (!input || typeof input !== 'object') return fallback
  return typeof input[key] === 'boolean' ? input[key] : fallback
}

async function createTempFile(label = 'runtime') {
  const safeLabel = String(label || 'runtime').replace(/[^a-z0-9_-]/gi, '-').slice(0, 32)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brickly-system-api-lab-'))
  const filePath = path.join(dir, `${safeLabel}-${Date.now()}-${randomUUID()}.txt`)
  await fs.writeFile(
    filePath,
    [
      'Brickly System API Lab',
      `createdAt=${new Date().toISOString()}`,
      `node=${process.version}`,
      `platform=${process.platform}`,
      ''
    ].join('\n'),
    'utf8'
  )
  return { dir, filePath, basename: path.basename(filePath) }
}

function summarize(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return `${value.slice(0, 48)}... (${value.length} chars)`
    return value.length > 240 ? `${value.slice(0, 240)}... (${value.length} chars)` : value
  }
  return value === undefined ? null : value
}

function normalizeError(error) {
  return {
    code: error && error.code ? String(error.code) : 'ERROR',
    message: error && error.message ? String(error.message) : String(error),
    details: error && error.details ? error.details : undefined
  }
}

async function record(report, name, run) {
  const startedAt = Date.now()
  try {
    const value = await run()
    const item = {
      name,
      ok: true,
      status: 'ok',
      ms: Date.now() - startedAt,
      result: summarize(value)
    }
    report.items.push(item)
    return item
  } catch (error) {
    const normalized = normalizeError(error)
    const item = {
      name,
      ok: false,
      status: 'error',
      ms: Date.now() - startedAt,
      error: normalized
    }
    report.items.push(item)
    return item
  }
}

async function runSystemSuite(ctx, input) {
  const system = ctx.platform.system
  const options = {
    notify: bool(input, 'notify', true),
    openExternal: bool(input, 'openExternal', false),
    openPath: bool(input, 'openPath', false),
    showInFolder: bool(input, 'showInFolder', false),
    trash: bool(input, 'trash', true),
    beep: bool(input, 'beep', true)
  }
  const temp = await createTempFile('runtime')
  const report = {
    source: 'runtime',
    brickId: BRICK_ID,
    createdAt: new Date().toISOString(),
    options,
    temp,
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    },
    items: []
  }

  await record(report, 'getAppName', () => system.getAppName())
  await record(report, 'getAppVersion', () => system.getAppVersion())
  await record(report, 'getNativeId', () => system.getNativeId())
  await record(report, 'isDev', () => system.isDev())
  await record(report, 'isMacOS', () => system.isMacOS())
  await record(report, 'isWindows', () => system.isWindows())
  await record(report, 'isLinux', () => system.isLinux())

  for (const name of PATH_NAMES) {
    await record(report, `getPath:${name}`, () => system.getPath(name))
  }

  await record(report, 'getFileIcon:.txt', () => system.getFileIcon('.txt'))
  await record(report, 'getFileIcon:folder', () => system.getFileIcon('folder'))
  await record(report, 'getFileIcon:temp-file', () => system.getFileIcon(temp.filePath))

  if (options.notify) {
    await record(report, 'showNotification', () =>
      system.showNotification('System API Lab runtime notification', 'system-api-lab')
    )
  }
  if (options.beep) await record(report, 'shellBeep', () => system.shellBeep())
  if (options.openExternal) {
    await record(report, 'shellOpenExternal', () => system.shellOpenExternal(DOC_URL))
  }
  if (options.openPath) {
    await record(report, 'shellOpenPath', () => system.shellOpenPath(temp.filePath))
  }
  if (options.showInFolder) {
    await record(report, 'shellShowItemInFolder', () => system.shellShowItemInFolder(temp.filePath))
  }
  if (options.trash) {
    await record(report, 'shellTrashItem', () => system.shellTrashItem(temp.filePath))
  }

  await record(report, 'readCurrentFolderPath', () => system.readCurrentFolderPath())
  await record(report, 'readCurrentBrowserUrl', () => system.readCurrentBrowserUrl())

  report.summary = summarizeReport(report.items)
  if (!options.trash) {
    report.note = 'trash=false 时会保留临时文件，便于手动验证 shellOpenPath/showItemInFolder。'
  }
  return report
}

function summarizeReport(items) {
  const failed = items.filter((item) => !item.ok)
  return {
    total: items.length,
    passed: items.length - failed.length,
    failed: failed.length,
    failedNames: failed.map((item) => item.name)
  }
}

async function logCurrentFolderPath(ctx) {
  brick.log.info('[System API Lab][hotkey] readCurrentFolderPath start', {
    invocation: ctx.invocation || null
  })
  try {
    const folderPath = await ctx.platform.system.readCurrentFolderPath()
    brick.log.info('[System API Lab][hotkey] current folder path', { folderPath })
  } catch (error) {
    const normalized = normalizeError(error)
    brick.log.error('[System API Lab][hotkey] readCurrentFolderPath failed', normalized)
  }
}

brick.onCommand('create-temp-file', async () => createTempFile('runtime-command'))
brick.onCommand('log-current-folder-path', logCurrentFolderPath)
brick.onCommand('run-system-suite', runSystemSuite)

brick.onReady(() => {
  brick.log.info('System API Lab runtime ready')
})

brick.start()

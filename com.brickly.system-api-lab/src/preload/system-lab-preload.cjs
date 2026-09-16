/* eslint-disable */
'use strict'

const { contextBridge } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

async function createTempFile(prefix = 'ui') {
  const safePrefix = String(prefix || 'ui').replace(/[^a-z0-9_-]/gi, '-').slice(0, 32)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brickly-system-api-lab-'))
  const filePath = path.join(dir, `${safePrefix}-${Date.now()}-${randomUUID()}.txt`)
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
  return {
    dir,
    filePath,
    basename: path.basename(filePath)
  }
}

async function cleanupPath(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') return false
  await fs.rm(targetPath, { recursive: true, force: true })
  return true
}

const api = {
  nodeInfo() {
    return {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      tmpdir: os.tmpdir()
    }
  },
  createTempFile,
  cleanupPath
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('systemLabNode', api)
} else {
  globalThis.systemLabNode = api
}

#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { parseArgs, setupBrick } = require('./setup-brick.cjs')

const root = path.resolve(__dirname, '..')
const failures = []
const { local } = parseArgs()

for (const name of fs.readdirSync(root).sort()) {
  const brickDir = path.join(root, name)
  if (!fs.statSync(brickDir).isDirectory()) continue
  if (!fs.existsSync(path.join(brickDir, 'manifest.json'))) continue
  try {
    setupBrick(brickDir, { local })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`FAILED ${name}: ${message}`)
    failures.push({ name, message })
  }
}

if (failures.length > 0) {
  console.error('\nsetup:all finished with errors:')
  for (const item of failures) console.error(`- ${item.name}: ${item.message}`)
  process.exit(1)
}

console.log('setup:all done')

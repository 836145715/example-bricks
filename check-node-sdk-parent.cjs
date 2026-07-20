/* eslint-disable no-console */
'use strict'

const fs = require('node:fs')
const path = require('path')

const bricksRoot = __dirname
const failures = []

/** 统一最新 Node SDK：vendor 内 0.1.2 tgz（BPP 0.2.0） */
const LATEST_NODE_SDK = 'file:../../../vendor/syllm-brickly-sdk-0.1.2.tgz'

function isLatestNodeSdk(version) {
  if (!version || typeof version !== 'string') return false
  if (version === LATEST_NODE_SDK) return true
  if (version === '^0.1.2' || version === '0.1.2') return true
  if (/syllm-brickly-sdk-0\.1\.2\.tgz$/.test(version)) return true
  return false
}

for (const brickId of fs.readdirSync(bricksRoot)) {
  const brickDir = path.join(bricksRoot, brickId)
  if (!fs.statSync(brickDir).isDirectory()) continue

  const runtimeNodeDir = path.join(brickDir, 'runtime', 'node')
  if (!fs.existsSync(runtimeNodeDir)) continue

  const sdkDir = path.join(runtimeNodeDir, '_sdk')
  if (fs.existsSync(sdkDir)) {
    failures.push(`${relative(sdkDir)} should be removed; use @syllm/brickly-sdk instead`)
  }

  const files = listFiles(runtimeNodeDir).filter((file) => /\.(?:cjs|js|mjs|ts|json)$/.test(file))
  const usesNpmSdk = files.some((file) =>
    fs.readFileSync(file, 'utf8').includes('@syllm/brickly-sdk')
  )

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    if (/require\(['"]\.\/_sdk['"]\)/.test(content)) {
      failures.push(`${relative(file)} still requires ./_sdk`)
    }
    if (/require\(['"]\.\.\/_sdk['"]\)/.test(content)) {
      failures.push(`${relative(file)} still requires ../_sdk`)
    }
    if (content.includes('@brickly/sdk')) {
      failures.push(`${relative(file)} still references @brickly/sdk`)
    }
  }

  if (usesNpmSdk) {
    const packageJsonPath = path.join(runtimeNodeDir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      failures.push(`${relative(packageJsonPath)} missing for @syllm/brickly-sdk runtime`)
      continue
    }
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const version = packageJson.dependencies && packageJson.dependencies['@syllm/brickly-sdk']
    if (!isLatestNodeSdk(version)) {
      failures.push(
        `${relative(packageJsonPath)} must depend on latest @syllm/brickly-sdk (got ${version ?? 'missing'}; expected ${LATEST_NODE_SDK} or ^0.1.2)`
      )
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('OK: Node bricks use latest @syllm/brickly-sdk without embedded _sdk')

function listFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      files.push(...listFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function relative(file) {
  return path.relative(bricksRoot, file).replace(/\\/g, '/')
}

/* eslint-disable no-console */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const bricksRoot = __dirname
const failures = []

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
    if (version !== '^0.1.0') {
      failures.push(`${relative(packageJsonPath)} must depend on @syllm/brickly-sdk@^0.1.0`)
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('OK: Node bricks use @syllm/brickly-sdk without embedded _sdk')

function listFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
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

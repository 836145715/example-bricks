/* eslint-disable no-console */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const bricksRoot = __dirname
const failures = []

for (const brickId of fs.readdirSync(bricksRoot)) {
  const brickDir = path.join(bricksRoot, brickId)
  if (!fs.statSync(brickDir).isDirectory()) continue

  const runtimeDirs = ['runtime/node', 'runtime/win-x64']
    .map((rel) => path.join(brickDir, rel))
    .filter((dir) => fs.existsSync(dir))

  for (const runtimeDir of runtimeDirs) {
    inspectRuntime(runtimeDir)
  }
}

function inspectRuntime(runtimeDir) {
  const sdkDir = path.join(runtimeDir, '_sdk')
  if (fs.existsSync(sdkDir)) {
    failures.push(`${relative(sdkDir)} should be removed; use @syllm/brickly-sdk instead`)
  }

  const files = listFiles(runtimeDir).filter((file) => /\.(?:cjs|js|mjs|ts|json)$/.test(file))
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

  if (!usesNpmSdk) return

  const packageJsonPath = path.join(runtimeDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    failures.push(`${relative(packageJsonPath)} missing for @syllm/brickly-sdk runtime`)
    return
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const version = packageJson.dependencies && packageJson.dependencies['@syllm/brickly-sdk']
  if (version !== '^0.6.0') {
    failures.push(`${relative(packageJsonPath)} must depend on @syllm/brickly-sdk@^0.6.0`)
  }

  const installedPkg = path.join(runtimeDir, 'node_modules/@syllm/brickly-sdk/package.json')
  if (!fs.existsSync(installedPkg)) {
    failures.push(`${relative(path.join(runtimeDir, 'node_modules/@syllm/brickly-sdk'))} is missing; run npm ci`)
    return
  }
  const installed = JSON.parse(fs.readFileSync(installedPkg, 'utf8')).version
  if (installed !== '0.6.0') {
    failures.push(`${relative(installedPkg)} must install 0.6.0, found ${installed}`)
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

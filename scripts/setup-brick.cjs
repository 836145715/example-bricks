#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const GO_TARGETS = {
  'win-x64': { goos: 'windows', goarch: 'amd64', suffix: '.exe' },
  'win-arm64': { goos: 'windows', goarch: 'arm64', suffix: '.exe' },
  'mac-x64': { goos: 'darwin', goarch: 'amd64', suffix: '' },
  'mac-arm64': { goos: 'darwin', goarch: 'arm64', suffix: '' },
  'linux-x64': { goos: 'linux', goarch: 'amd64', suffix: '' },
  'linux-arm64': { goos: 'linux', goarch: 'arm64', suffix: '' }
}

const CGO_BRICKS = new Set(['com.brickly.net-capture'])

function currentPlatform() {
  const { platform, arch } = process
  if (platform === 'win32') return arch === 'arm64' ? 'win-arm64' : 'win-x64'
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

function brickRootFromArgs() {
  if (process.argv[2]) return path.resolve(process.argv[2])
  if (process.env.npm_package_json) return path.dirname(process.env.npm_package_json)
  return process.cwd()
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? ['cmd.exe', ['/c', 'where', command]] : ['sh', ['-lc', `command -v ${command}`]]
  const result = spawnSync(probe[0], probe[1], { encoding: 'utf8', stdio: 'pipe' })
  return result.status === 0
}

function run(command, args, options) {
  const printable = [command, ...args].join(' ')
  console.log(`$ ${printable}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && command !== 'go',
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`)
  }
}

function hasNpmDeps(pkg) {
  return Boolean(
    (pkg.dependencies && Object.keys(pkg.dependencies).length) ||
      (pkg.devDependencies && Object.keys(pkg.devDependencies).length)
  )
}

function npmInstall(dir) {
  const args = fs.existsSync(path.join(dir, 'package-lock.json')) ? ['ci'] : ['install']
  run('npm', args, { cwd: dir })
}

function walkFiles(root, depth, visit) {
  if (!fs.existsSync(root) || depth < 0) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.venv' || entry.name === '.git') continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) walkFiles(full, depth - 1, visit)
    else visit(full)
  }
}

function findRuntimePackageDirs(brickRoot) {
  const dirs = []
  walkFiles(path.join(brickRoot, 'runtime'), 3, (file) => {
    if (path.basename(file) === 'package.json') dirs.push(path.dirname(file))
  })
  return dirs
}

function findGoModDirs(brickRoot) {
  const dirs = []
  walkFiles(path.join(brickRoot, 'runtime'), 3, (file) => {
    if (path.basename(file) === 'go.mod') dirs.push(path.dirname(file))
  })
  return dirs
}

function findPyProjectDirs(brickRoot) {
  const dirs = []
  walkFiles(path.join(brickRoot, 'runtime'), 3, (file) => {
    if (path.basename(file) === 'pyproject.toml') dirs.push(path.dirname(file))
  })
  return dirs
}

function binaryOutput(brickRoot, platform) {
  const manifestFile = path.join(brickRoot, 'manifest.json')
  if (fs.existsSync(manifestFile)) {
    const manifest = readJson(manifestFile)
    const entry = manifest.runtime && manifest.runtime.entry && manifest.runtime.entry[platform]
    if (entry) return path.join(brickRoot, entry)
  }
  const target = GO_TARGETS[platform]
  return path.join(brickRoot, 'runtime', platform, `brick${target.suffix}`)
}

function installRoot(brickRoot) {
  const pkgFile = path.join(brickRoot, 'package.json')
  const pkg = readJson(pkgFile)
  if (!hasNpmDeps(pkg)) {
    console.log('skip root npm install (no dependencies)')
    return pkg
  }
  npmInstall(brickRoot)
  return pkg
}

function installRuntime(brickRoot) {
  const dirs = findRuntimePackageDirs(brickRoot)
  if (dirs.length === 0) {
    console.log('skip runtime npm install (no runtime package.json)')
    return
  }
  for (const dir of dirs) npmInstall(dir)
}

function syncPython(brickRoot) {
  const dirs = findPyProjectDirs(brickRoot)
  if (dirs.length === 0) {
    console.log('skip python sync (no pyproject.toml)')
    return
  }
  if (!commandExists('uv')) {
    console.log('skip python sync (uv not found; host will prepare venv on first run)')
    return
  }
  for (const dir of dirs) {
    try {
      // Refresh brickly-sdk URLs/hashes. Old locks were hand-bumped to 0.6.0
      // but still point at the 0.5.0 wheel path, which 404s on PyPI.
      run('uv', ['lock', '--upgrade-package', 'brickly-sdk'], { cwd: dir })
      run('uv', ['sync'], { cwd: dir })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`python sync failed in ${dir}: ${message}`)
      console.warn('continue setup; host can still prepare the venv on first run')
    }
  }
}

function buildGo(brickRoot, brickId) {
  const dirs = findGoModDirs(brickRoot)
  if (dirs.length === 0) {
    console.log('skip go build (no go.mod)')
    return
  }
  if (!commandExists('go')) {
    throw new Error(`Go toolchain is required to build ${brickId}`)
  }

  const platform = currentPlatform()
  const builder = dirs.map((dir) => path.join(dir, 'build.mjs')).find((file) => fs.existsSync(file))
  if (builder) {
    run(process.execPath, [builder, platform], { cwd: path.dirname(builder) })
    return
  }

  const target = GO_TARGETS[platform]
  const output = binaryOutput(brickRoot, platform)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const cgo = CGO_BRICKS.has(brickId) ? '1' : '0'
  for (const dir of dirs) {
    console.log(`Building ${brickId} ${platform} -> ${output}`)
    run('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'], {
      cwd: dir,
      env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: cgo }
    })
  }
}

function buildUi(brickRoot, pkg) {
  const build = pkg.scripts && pkg.scripts.build
  if (!build || build.includes('setup-brick')) {
    console.log('skip ui build (no build script)')
    return
  }
  run('npm', ['run', 'build'], { cwd: brickRoot })
}

function brickIdOf(brickRoot) {
  const manifestFile = path.join(brickRoot, 'manifest.json')
  if (fs.existsSync(manifestFile)) return readJson(manifestFile).id
  return path.basename(brickRoot)
}

function setupBrick(brickRoot) {
  const pkgFile = path.join(brickRoot, 'package.json')
  if (!fs.existsSync(pkgFile)) {
    throw new Error(`Missing package.json in ${brickRoot}`)
  }
  const brickId = brickIdOf(brickRoot)
  console.log(`\n== setup ${brickId} ==\n`)
  const pkg = installRoot(brickRoot)
  installRuntime(brickRoot)
  syncPython(brickRoot)
  buildGo(brickRoot, brickId)
  buildUi(brickRoot, pkg)
  console.log(`\n== setup ${brickId} done ==\n`)
}

if (require.main === module) {
  try {
    setupBrick(brickRootFromArgs())
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

module.exports = { setupBrick, currentPlatform }

#!/usr/bin/env node
'use strict'

/**
 * 把 example-bricks 的已发布 SDK pin 升到指定版本（默认读旁边 ai-bricks 的包号）。
 *
 * 仓库里继续钉 npm / PyPI / Go module 的已发布版本，方便别人 clone 就能装。
 * 日常联调本地源码不要改 pin，用：
 *   npm run setup:all:local
 * 或单个工具：
 *   npm run setup -- --local
 *
 * 发布完 SDK 之后：
 *   npm run sync-sdk
 *   npm run check-sdk
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const pinFile = path.join(root, 'sdk-pin.json')
const goModule = 'github.com/836145715/brickly-sdk-go'
const skipDir = new Set(['.git', 'node_modules', '.venv', '.worktrees', 'dist'])

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    version: null,
    dryRun: false,
    locks: true
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--pins-only') options.locks = false
    else if (arg === '--version') options.version = argv[++i]
    else if (arg === '-h' || arg === '--help') {
      console.log(`Usage:
  node scripts/sync-sdk-version.cjs [--version 0.9.0] [--pins-only] [--dry-run]

默认版本来自旁边 ai-bricks 的 @syllm/brickly-sdk package.json。
`)
      process.exit(0)
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  return options
}

function resolveBricklyHome() {
  if (process.env.BRICKLY_HOME) return path.resolve(process.env.BRICKLY_HOME)
  const sibling = path.resolve(root, '..', 'ai-bricks')
  if (fs.existsSync(path.join(sibling, 'Brickly', 'packages', 'brickly-sdk-node', 'package.json'))) {
    return sibling
  }
  return null
}

function versionFromAiBricks() {
  const home = resolveBricklyHome()
  if (!home) return null
  const pkg = JSON.parse(
    fs.readFileSync(path.join(home, 'Brickly', 'packages', 'brickly-sdk-node', 'package.json'), 'utf8')
  )
  return pkg.version
}

function lineEnding(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function writeText(file, next, dryRun) {
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const nl = lineEnding(previous || '\n')
  const body = `${String(next).replace(/\r?\n/g, nl).replace(/(?:\r?\n)+$/, '')}${nl}`
  if (body === previous) return false
  const rel = path.relative(root, file)
  if (dryRun) {
    console.log(`dry-run ${rel}`)
    return true
  }
  fs.writeFileSync(file, body)
  console.log(`update ${rel}`)
  return true
}

function walk(dir, visit) {
  for (const name of fs.readdirSync(dir)) {
    if (skipDir.has(name)) continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      walk(full, visit)
      continue
    }
    visit(full)
  }
}

function commandExists(command) {
  const probe =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'where', command]]
      : ['sh', ['-lc', `command -v ${command}`]]
  return spawnSync(probe[0], probe[1], { encoding: 'utf8', stdio: 'pipe' }).status === 0
}

function run(command, args, cwd) {
  const printable = [command, ...args].join(' ')
  console.log(`$ ${printable}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command !== 'go',
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`)
  }
}

function bumpPackageJson(file, version, dryRun) {
  const original = fs.readFileSync(file, 'utf8')
  let pkg
  try {
    pkg = JSON.parse(original)
  } catch {
    return false
  }
  const spec = `^${version}`
  let changed = false
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg[field]
    if (!deps) continue
    for (const name of ['@syllm/brickly-sdk', '@syllm/brickly-ui']) {
      if (deps[name] && deps[name] !== spec) {
        deps[name] = spec
        changed = true
      }
    }
  }
  if (!changed) return false
  return writeText(file, `${JSON.stringify(pkg, null, 2)}\n`, dryRun)
}

function bumpGoMod(file, version, dryRun) {
  const original = fs.readFileSync(file, 'utf8')
  if (!original.includes(goModule)) return false
  const next = original.replace(
    new RegExp(`${goModule.replaceAll('.', '\\.')}\\s+v\\d+\\.\\d+\\.\\d+`, 'g'),
    `${goModule} v${version}`
  )
  if (next === original) return false
  return writeText(file, next, dryRun)
}

function bumpPythonSpec(file, version, dryRun) {
  const original = fs.readFileSync(file, 'utf8')
  if (!original.includes('brickly-sdk==')) return false
  const next = original.replace(/brickly-sdk==\d+\.\d+\.\d+/g, `brickly-sdk==${version}`)
  if (next === original) return false
  return writeText(file, next, dryRun)
}

function packageHasSdk(file) {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return Boolean(deps['@syllm/brickly-sdk'] || deps['@syllm/brickly-ui'])
  } catch {
    return false
  }
}

function main() {
  const options = parseArgs()
  const version = options.version || versionFromAiBricks()
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('请传 --version 0.9.0，或把 example-bricks 和 ai-bricks 放在同一父目录')
  }

  console.log(`pin SDK ${version}${options.dryRun ? ' (dry-run)' : ''}`)
  const pin = { version, protocol: 'brickly.runtime.v1' }
  writeText(pinFile, `${JSON.stringify(pin, null, 2)}\n`, options.dryRun)

  const npmDirs = []
  const goDirs = []
  const pyDirs = []

  walk(root, (file) => {
    const name = path.basename(file)
    if (name === 'package.json') {
      bumpPackageJson(file, version, options.dryRun)
      if (packageHasSdk(file)) npmDirs.push(path.dirname(file))
      return
    }
    if (name === 'go.mod') {
      bumpGoMod(file, version, options.dryRun)
      if (fs.readFileSync(file, 'utf8').includes(goModule)) goDirs.push(path.dirname(file))
      return
    }
    if (name === 'pyproject.toml' || name === 'requirements.txt') {
      bumpPythonSpec(file, version, options.dryRun)
      if (fs.readFileSync(file, 'utf8').includes('brickly-sdk==')) pyDirs.push(path.dirname(file))
    }
  })

  if (!options.locks || options.dryRun) {
    console.log(`done: example-bricks SDK pin is ${version}${options.locks ? '' : ' (pins only)'}`)
    return
  }

  if (goDirs.length > 0) {
    if (!commandExists('go')) {
      console.warn('skip go.sum (go not found)')
    } else {
      for (const dir of goDirs) {
        run('go', ['get', `${goModule}@v${version}`], dir)
        run('go', ['mod', 'tidy'], dir)
      }
    }
  }

  if (pyDirs.length > 0) {
    if (!commandExists('uv')) {
      console.warn('skip uv.lock (uv not found)')
    } else {
      for (const dir of [...new Set(pyDirs)]) {
        run('uv', ['lock', '--upgrade-package', 'brickly-sdk'], dir)
      }
    }
  }

  for (const dir of npmDirs) {
    if (!fs.existsSync(path.join(dir, 'package-lock.json'))) continue
    run('npm', ['install'], dir)
  }

  console.log(`done: example-bricks SDK pin is ${version}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

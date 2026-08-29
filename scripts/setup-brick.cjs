#!/usr/bin/env node
'use strict'

/**
 * 默认按 lock 从 npm / Go module / PyPI 装已发布的 0.7.0。
 * 联调旁边的 ai-bricks 源码：`npm run setup -- --local` 或 `BRICKLY_LOCAL=1`。
 * --local 不改 package.json / go.mod；只在安装后把依赖指到本地包。
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const GO_SDK_MODULE = 'github.com/836145715/brickly-sdk-go'

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

function parseArgs(argv = process.argv.slice(2)) {
  return {
    local: argv.includes('--local') || process.env.BRICKLY_LOCAL === '1',
    brickRoot: argv.find((item) => !item.startsWith('-'))
  }
}

function brickRootFromArgs(parsed = parseArgs()) {
  if (parsed.brickRoot) return path.resolve(parsed.brickRoot)
  if (process.env.npm_package_json) return path.dirname(process.env.npm_package_json)
  return process.cwd()
}

function resolveBricklyHome() {
  if (process.env.BRICKLY_HOME) return path.resolve(process.env.BRICKLY_HOME)
  const sibling = path.resolve(__dirname, '..', '..', 'ai-bricks')
  if (fs.existsSync(path.join(sibling, 'Brickly', 'packages'))) return sibling
  return null
}

function resolveLocalPackages() {
  const home = resolveBricklyHome()
  if (!home) {
    throw new Error(
      '找不到本地 ai-bricks。把 example-bricks 和 ai-bricks 放在同一父目录，或设置 BRICKLY_HOME。'
    )
  }
  const packages = path.join(home, 'Brickly', 'packages')
  const pick = (name) => {
    const dir = path.join(packages, name)
    return fs.existsSync(dir) ? dir : null
  }
  return {
    home,
    sdkNode: pick('brickly-sdk-node'),
    sdkUi: pick('brickly-ui'),
    sdkGo: pick('brickly-sdk-go'),
    sdkPy: pick('brickly-sdk-python')
  }
}

function ensureNodeSdkBuilt(sdkNode) {
  if (!sdkNode) return
  if (fs.existsSync(path.join(sdkNode, 'dist', 'index.js'))) return
  console.log('building local @syllm/brickly-sdk')
  run('npm', ['run', 'build'], { cwd: sdkNode })
}

function linkLocalPackage(brickPkgDir, name, target) {
  const dest = path.join(brickPkgDir, 'node_modules', ...name.split('/'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.rmSync(dest, { recursive: true, force: true })
  fs.symlinkSync(target, dest, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(`link ${name} -> ${target}`)
}

function applyLocalNpm(dir, locals) {
  const pkgFile = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgFile)) return
  const pkg = readJson(pkgFile)
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if (deps['@syllm/brickly-sdk'] && locals.sdkNode) {
    linkLocalPackage(dir, '@syllm/brickly-sdk', locals.sdkNode)
  }
  if (deps['@syllm/brickly-ui'] && locals.sdkUi) {
    linkLocalPackage(dir, '@syllm/brickly-ui', locals.sdkUi)
  }
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

function npmInstall(dir, local = false) {
  if (local) {
    installPublishedNpmDeps(dir)
    return
  }
  const args = fs.existsSync(path.join(dir, 'package-lock.json')) ? ['ci'] : ['install']
  run('npm', args, { cwd: dir })
}

/** --local 不从 npm 拉未发布的 @syllm/brickly-sdk@0.7.0，只装其余依赖，SDK 随后 symlink。 */
function installPublishedNpmDeps(dir) {
  const pkgFile = path.join(dir, 'package.json')
  const original = fs.readFileSync(pkgFile, 'utf8')
  const pkg = JSON.parse(original)
  if (pkg.dependencies) delete pkg.dependencies['@syllm/brickly-sdk']
  if (pkg.devDependencies) delete pkg.devDependencies['@syllm/brickly-sdk']
  const names = []
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    names.push(`${name}@${spec}`)
  }
  try {
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
    if (names.length === 0) {
      fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
      return
    }
    run('npm', ['install', '--no-save', '--no-package-lock', ...names], { cwd: dir })
  } finally {
    fs.writeFileSync(pkgFile, original)
  }
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

function findRuntimePackageDirs(brickRoot, local = false) {
  const runtimeRoot = path.join(brickRoot, 'runtime')
  if (local) {
    const dirs = []
    for (const name of ['node', currentPlatform()]) {
      const pkg = path.join(runtimeRoot, name, 'package.json')
      if (fs.existsSync(pkg)) dirs.push(path.dirname(pkg))
    }
    if (dirs.length > 0) return dirs
  }
  const dirs = []
  walkFiles(runtimeRoot, 3, (file) => {
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

function pythonExtraSpecs(dir) {
  const text = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8')
  const block = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
  if (!block) return []
  return [...block[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((spec) => !spec.startsWith('brickly-sdk'))
}

function findPyProjectDirs(brickRoot, local = false) {
  const runtimeRoot = path.join(brickRoot, 'runtime')
  if (local) {
    for (const name of [currentPlatform(), 'win-x64']) {
      const dir = path.join(runtimeRoot, name)
      if (fs.existsSync(path.join(dir, 'pyproject.toml'))) return [dir]
    }
  }
  const dirs = []
  walkFiles(runtimeRoot, 3, (file) => {
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

function installRoot(brickRoot, locals) {
  const pkgFile = path.join(brickRoot, 'package.json')
  const pkg = readJson(pkgFile)
  if (!hasNpmDeps(pkg)) {
    console.log('skip root npm install (no dependencies)')
    return pkg
  }
  npmInstall(brickRoot, Boolean(locals))
  if (locals) applyLocalNpm(brickRoot, locals)
  return pkg
}

function installRuntime(brickRoot, locals) {
  const dirs = findRuntimePackageDirs(brickRoot, Boolean(locals))
  if (dirs.length === 0) {
    console.log('skip runtime npm install (no runtime package.json)')
    return
  }
  for (const dir of dirs) {
    npmInstall(dir, Boolean(locals))
    if (locals) applyLocalNpm(dir, locals)
  }
}

function syncPython(brickRoot, locals) {
  const dirs = findPyProjectDirs(brickRoot, Boolean(locals))
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
      if (locals?.sdkPy) {
        const extras = pythonExtraSpecs(dir)
        run('uv', ['venv'], { cwd: dir })
        run('uv', ['pip', 'install', '-e', locals.sdkPy, ...extras], { cwd: dir })
        continue
      }
      // Refresh brickly-sdk URLs/hashes. Old locks were hand-bumped to 0.7.0
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

function withLocalGoReplace(dir, sdkGo, fn) {
  if (!sdkGo) return fn()
  const goMod = path.join(dir, 'go.mod')
  const goSum = path.join(dir, 'go.sum')
  if (!fs.existsSync(goMod)) return fn()
  const modOrig = fs.readFileSync(goMod, 'utf8')
  const sumExisted = fs.existsSync(goSum)
  const sumOrig = sumExisted ? fs.readFileSync(goSum) : null
  const posix = sdkGo.replace(/\\/g, '/')
  if (!modOrig.includes(`replace ${GO_SDK_MODULE}`)) {
    fs.appendFileSync(goMod, `\nreplace ${GO_SDK_MODULE} => ${posix}\n`)
  }
  try {
    return fn()
  } finally {
    fs.writeFileSync(goMod, modOrig)
    if (sumOrig) fs.writeFileSync(goSum, sumOrig)
    else if (!sumExisted && fs.existsSync(goSum)) fs.rmSync(goSum)
  }
}

function buildGo(brickRoot, brickId, locals) {
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
    const dir = path.dirname(builder)
    withLocalGoReplace(dir, locals?.sdkGo, () => {
      run(process.execPath, [builder, platform], { cwd: dir })
    })
    return
  }

  const target = GO_TARGETS[platform]
  const output = binaryOutput(brickRoot, platform)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const cgo = CGO_BRICKS.has(brickId) ? '1' : '0'
  for (const dir of dirs) {
    console.log(`Building ${brickId} ${platform} -> ${output}`)
    withLocalGoReplace(dir, locals?.sdkGo, () => {
      run('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'], {
        cwd: dir,
        env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: cgo }
      })
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

function setupBrick(brickRoot, options = {}) {
  if (!fs.existsSync(path.join(brickRoot, 'manifest.json'))) {
    throw new Error(`Missing manifest.json in ${brickRoot}`)
  }
  const locals = options.local ? resolveLocalPackages() : null
  if (locals) {
    console.log(`using local SDK from ${locals.home}`)
    ensureNodeSdkBuilt(locals.sdkNode)
  }
  const brickId = brickIdOf(brickRoot)
  console.log(`\n== setup ${brickId} ==\n`)
  const pkgFile = path.join(brickRoot, 'package.json')
  const pkg = fs.existsSync(pkgFile) ? installRoot(brickRoot, locals) : {}
  installRuntime(brickRoot, locals)
  syncPython(brickRoot, locals)
  buildGo(brickRoot, brickId, locals)
  const uiSrc = path.join(brickRoot, 'ui-src')
  if (fs.existsSync(path.join(uiSrc, 'package.json'))) {
    npmInstall(uiSrc, Boolean(locals))
    if (locals) applyLocalNpm(uiSrc, locals)
    if (readJson(path.join(uiSrc, 'package.json')).scripts?.build) {
      run('npm', ['run', 'build'], { cwd: uiSrc })
    }
  } else {
    buildUi(brickRoot, pkg)
  }
  console.log(`\n== setup ${brickId} done ==\n`)
}

if (require.main === module) {
  try {
    const parsed = parseArgs()
    setupBrick(brickRootFromArgs(parsed), { local: parsed.local })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

module.exports = { setupBrick, currentPlatform, parseArgs }

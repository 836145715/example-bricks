#!/usr/bin/env node
'use strict'

/**
 * 默认按 lock 从 npm / Go module / PyPI 装已发布 SDK（版本见仓库根 sdk-pin.json）。
 * 联调旁边的 ai-bricks 源码：`npm run setup -- --local` 或 `BRICKLY_LOCAL=1`。
 * --local 不改 package.json / go.mod；只在安装后把依赖指到本地包。
 * 发布完新 SDK 后先 `npm run sync-sdk` 升 pin，再 `npm run setup:all`。
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

const CGO_BRICKS = new Set(['com.brickly.net-capture', 'com.brickly.sunnynettools'])

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
    sdkPy: pick('brickly-sdk-python'),
    sdkCpp: pick('brickly-sdk-cpp'),
    sdkDotnet: pick('brickly-sdk-dotnet')
  }
}

function newestMtime(dir) {
  let newest = 0
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) newest = Math.max(newest, newestMtime(full))
    else newest = Math.max(newest, fs.statSync(full).mtimeMs)
  }
  return newest
}

function ensureNodeSdkBuilt(sdkNode) {
  if (!sdkNode) return
  const distIndex = path.join(sdkNode, 'dist', 'index.js')
  const srcDir = path.join(sdkNode, 'src')
  const distFresh =
    fs.existsSync(distIndex) &&
    (!fs.existsSync(srcDir) || fs.statSync(distIndex).mtimeMs >= newestMtime(srcDir))
  if (distFresh) return
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
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) {
    try {
      run('npm', ['ci'], { cwd: dir })
      return
    } catch {
      // 例：sync-sdk 升 pin 后 lock 未重生成 → ci 拒装，退回 install 并提醒
      console.warn(`npm ci failed in ${dir}（lock 可能过期），退回 npm install`)
    }
  }
  run('npm', ['install'], { cwd: dir })
}

/** --local 不从 npm 拉 brickly-sdk / brickly-ui，只装其余依赖，SDK 随后 symlink。 */
function installPublishedNpmDeps(dir) {
  const pkgFile = path.join(dir, 'package.json')
  const original = fs.readFileSync(pkgFile, 'utf8')
  const pkg = JSON.parse(original)
  for (const field of ['dependencies', 'devDependencies']) {
    if (!pkg[field]) continue
    delete pkg[field]['@syllm/brickly-sdk']
    delete pkg[field]['@syllm/brickly-ui']
  }
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

// src/out 双根契约：作者树 src/，成品树 out/（Host 只加载 out/）
function srcRuntime(brickRoot) {
  return path.join(brickRoot, 'src', 'runtime')
}

function srcUi(brickRoot) {
  return path.join(brickRoot, 'src', 'ui')
}

function srcPreload(brickRoot) {
  return path.join(brickRoot, 'src', 'preload')
}

function outRuntimeSegment(brickRoot, platform) {
  return path.join(brickRoot, 'out', 'runtime', platform)
}

/** src/runtime 下的 package.json 目录（根 + foreign 子目录，bin/ 除外） */
function findRuntimePackageDirs(brickRoot) {
  const root = srcRuntime(brickRoot)
  const dirs = []
  if (fs.existsSync(path.join(root, 'package.json'))) dirs.push(root)
  if (!fs.existsSync(root)) return dirs
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'bin') continue
    if (fs.existsSync(path.join(root, entry.name, 'package.json')))
      dirs.push(path.join(root, entry.name))
  }
  return dirs
}

function findGoModDirs(brickRoot) {
  const dirs = []
  walkFiles(srcRuntime(brickRoot), 2, (file) => {
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

function findPyProjectDirs(brickRoot) {
  const root = srcRuntime(brickRoot)
  const dirs = []
  if (fs.existsSync(path.join(root, 'pyproject.toml'))) dirs.push(root)
  if (!fs.existsSync(root)) return dirs
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'bin') continue
    if (fs.existsSync(path.join(root, entry.name, 'pyproject.toml')))
      dirs.push(path.join(root, entry.name))
  }
  return dirs
}

/** 固定产物路径：out/runtime/<platform>/brick[.exe]（entry 已非作者可配） */
function binaryOutput(brickRoot, platform) {
  const target = GO_TARGETS[platform]
  return path.join(outRuntimeSegment(brickRoot, platform), `brick${target.suffix}`)
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

const RUNTIME_COPY_EXCLUDES = new Set(['node_modules', 'bin', 'obj', '.venv', '__pycache__', '.cache'])

function copyTreeFiltered(from, to, excludeDirs) {
  fs.rmSync(to, { recursive: true, force: true })
  fs.cpSync(from, to, {
    recursive: true,
    filter: (srcPath) =>
      !(fs.statSync(srcPath).isDirectory() && excludeDirs.has(path.basename(srcPath)))
  })
  return to
}

/** src/runtime → out/runtime/<platform> 源码复制（依赖目录不入 out，由装依赖步骤重建） */
function stageRuntime(brickRoot, platform) {
  return copyTreeFiltered(srcRuntime(brickRoot), outRuntimeSegment(brickRoot, platform), RUNTIME_COPY_EXCLUDES)
}

/**
 * 含 package.json/pyproject.toml 的源码目录 → out 落点：
 * src/runtime 根 → out/runtime/<platform>；foreign 子目录 → out/runtime/<name>（仅本机联调）。
 */
function stageRuntimeDir(brickRoot, dir, platform) {
  if (dir === srcRuntime(brickRoot)) return stageRuntime(brickRoot, platform)
  return copyTreeFiltered(dir, path.join(brickRoot, 'out', 'runtime', path.basename(dir)), RUNTIME_COPY_EXCLUDES)
}

/** node runtime：源码复制进 out/runtime/<platform>，依赖装在 out 段内（src/ 不污染） */
function installRuntime(brickRoot, locals) {
  const dirs = findRuntimePackageDirs(brickRoot)
  if (dirs.length === 0) {
    console.log('skip runtime npm install (no src/runtime package.json)')
    return
  }
  const platform = currentPlatform()
  for (const dir of dirs) {
    const dest = stageRuntimeDir(brickRoot, dir, platform)
    npmInstall(dest, Boolean(locals))
    if (locals) applyLocalNpm(dest, locals)
  }
}

/** python runtime：源码复制进 out/runtime/<platform>，在 out 段内 uv sync 出 .venv */
function syncPython(brickRoot, locals) {
  const dirs = findPyProjectDirs(brickRoot)
  if (dirs.length === 0) {
    console.log('skip python sync (no src/runtime pyproject.toml)')
    return
  }
  if (!commandExists('uv')) {
    console.log('skip python sync (uv not found; host will prepare venv on first run)')
    return
  }
  const platform = currentPlatform()
  for (const dir of dirs) {
    try {
      if (locals?.sdkPy) {
        const dest = stageRuntimeDir(brickRoot, dir, platform)
        const extras = pythonExtraSpecs(dir)
        run('uv', ['venv'], { cwd: dest })
        run('uv', ['pip', 'install', '-e', locals.sdkPy, ...extras], { cwd: dest })
        continue
      }
      // 先在 src/ 里刷新 brickly-sdk pin，再带着新 lock 落盘到 out 段
      run('uv', ['lock', '--upgrade-package', 'brickly-sdk'], { cwd: dir })
      const dest = stageRuntimeDir(brickRoot, dir, platform)
      run('uv', ['sync', '--locked', '--no-build', '--no-sources', '--no-install-project'], { cwd: dest })
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
  const outSeg = outRuntimeSegment(brickRoot, platform)
  const builder = dirs.map((dir) => path.join(dir, 'build.mjs')).find((file) => fs.existsSync(file))
  if (builder) {
    const dir = path.dirname(builder)
    withLocalGoReplace(dir, locals?.sdkGo, () => {
      run(process.execPath, [builder, platform], {
        cwd: dir,
        env: { ...process.env, BRICKLY_BUILD_OUT: outSeg }
      })
    })
    return
  }

  const target = GO_TARGETS[platform]
  const output = binaryOutput(brickRoot, platform)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const cgo = CGO_BRICKS.has(brickId) ? '1' : '0'
  // CGO 走 mingw 外链：-s 会让 strip 打出 Windows 拒载的 PE（spawn EFTYPE / 193）。
  const ldflags = cgo === '1' ? '-w' : '-s -w'
  for (const dir of dirs) {
    console.log(`Building ${brickId} ${platform} -> ${output}`)
    withLocalGoReplace(dir, locals?.sdkGo, () => {
      run('go', ['build', '-trimpath', '-ldflags', ldflags, '-o', output, '.'], {
        cwd: dir,
        env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: cgo }
      })
    })
  }
}

function findDotnetProjects(brickRoot) {
  const projects = []
  walkFiles(srcRuntime(brickRoot), 2, (file) => {
    if (path.basename(file).endsWith('.csproj')) projects.push(file)
  })
  return projects
}

/** --local：临时把 PackageReference 换成 ProjectReference，跑完恢复，不改 pin。 */
function withLocalDotnetReplace(projectFile, sdkDotnet, fn) {
  if (!sdkDotnet) return fn()
  const sdkProject = path.join(sdkDotnet, 'src', 'Syllm.Brickly.Sdk', 'Syllm.Brickly.Sdk.csproj')
  if (!fs.existsSync(sdkProject)) return fn()
  const original = fs.readFileSync(projectFile, 'utf8')
  const pattern = /<PackageReference Include="Syllm\.Brickly\.Sdk"[^/]*\/>/
  if (!pattern.test(original)) return fn()
  const posix = sdkProject.replace(/\\/g, '/')
  fs.writeFileSync(projectFile, original.replace(pattern, `<ProjectReference Include="${posix}" />`))
  try {
    return fn()
  } finally {
    fs.writeFileSync(projectFile, original)
  }
}

function buildDotnet(brickRoot, brickId, locals) {
  const projects = findDotnetProjects(brickRoot)
  if (projects.length === 0) {
    console.log('skip dotnet build (no csproj)')
    return
  }
  if (!commandExists('dotnet')) {
    throw new Error(`.NET SDK is required to build ${brickId}`)
  }
  const platform = currentPlatform()
  const output = outRuntimeSegment(brickRoot, platform)
  fs.mkdirSync(output, { recursive: true })
  for (const project of projects) {
    const dir = path.dirname(project)
    const builder = path.join(dir, 'build.mjs')
    console.log(`Building ${brickId} .NET ${platform} -> ${output}`)
    withLocalDotnetReplace(project, locals?.sdkDotnet, () => {
      // 有契约构建脚本（build.mjs 认 BRICKLY_BUILD_OUT）就走脚本，否则直发 dotnet publish
      if (fs.existsSync(builder)) {
        run(process.execPath, [builder, platform], {
          cwd: dir,
          env: { ...process.env, BRICKLY_BUILD_OUT: output }
        })
      } else {
        run('dotnet', ['publish', '-c', 'Release', '-o', output, '--nologo'], { cwd: dir })
      }
    })
  }
}

function findCppMain(brickRoot) {
  const dirs = []
  walkFiles(srcRuntime(brickRoot), 2, (file) => {
    if (path.basename(file) === 'main.cpp') dirs.push(path.dirname(file))
  })
  return dirs[0] || null
}

function buildCpp(brickRoot, brickId, locals) {
  const dir = findCppMain(brickRoot)
  if (!dir) {
    console.log('skip cpp build (no src/runtime main.cpp)')
    return
  }
  const home = locals?.home || resolveBricklyHome()
  if (!home) {
    throw new Error(
      `C++ Brick ${brickId} 需要本地 ai-bricks（brickly-sdk-cpp 尚未发布）。使用 npm run setup -- --local 或设置 BRICKLY_HOME。`
    )
  }
  const builder = path.join(dir, 'build.mjs')
  if (!fs.existsSync(builder)) {
    throw new Error(`Missing ${builder}`)
  }
  const platform = currentPlatform()
  console.log(`Building ${brickId} C++ ${platform}`)
  run(process.execPath, [builder, platform], {
    cwd: dir,
    env: {
      ...process.env,
      BRICKLY_HOME: home,
      CGO_ENABLED: '1',
      BRICKLY_BUILD_OUT: outRuntimeSegment(brickRoot, platform)
    }
  })
}

/**
 * UI 段：src/ui → out/ui。
 * - 有 package.json（vite 工程）：装依赖在 src/ui，构建产物经 --outDir 落 out/ui
 * - 无 package.json（静态页）：整目录复制进 out/ui（含 ui.type=none 的开窗资源）
 */
function buildUi(brickRoot, locals) {
  const uiSrc = srcUi(brickRoot)
  if (!fs.existsSync(uiSrc)) return
  const outUi = path.join(brickRoot, 'out', 'ui')
  const pkgFile = path.join(uiSrc, 'package.json')
  if (!fs.existsSync(pkgFile)) {
    copyTreeFiltered(uiSrc, outUi, new Set(['node_modules', '.cache']))
    console.log('static ui copied -> out/ui')
    return
  }
  const pkg = readJson(pkgFile)
  if (hasNpmDeps(pkg)) {
    npmInstall(uiSrc, Boolean(locals))
    if (locals) applyLocalNpm(uiSrc, locals)
  }
  if (!pkg.scripts?.build) {
    console.log('skip ui build (src/ui 有 package.json 但无 build 脚本)')
    return
  }
  run('npm', ['run', 'build', '--', '--outDir', outUi, '--emptyOutDir'], { cwd: uiSrc })
}

/** src/preload → out/preload 纯拷贝（无依赖单文件） */
function stagePreload(brickRoot) {
  const src = srcPreload(brickRoot)
  if (!fs.existsSync(src)) return
  copyTreeFiltered(src, path.join(brickRoot, 'out', 'preload'), new Set(['node_modules', '.cache']))
  console.log('preload copied -> out/preload')
}

function brickIdOf(brickRoot) {
  const manifestFile = path.join(brickRoot, 'manifest.json')
  if (fs.existsSync(manifestFile)) return readJson(manifestFile).id
  return path.basename(brickRoot)
}

/** manifest.runtime.platforms 不含当前平台 → 本机无需构建 runtime（如 disk-map 仅 macOS） */
function platformSupported(brickRoot, platform) {
  const manifestFile = path.join(brickRoot, 'manifest.json')
  if (!fs.existsSync(manifestFile)) return true
  const platforms = readJson(manifestFile).runtime?.platforms
  return !Array.isArray(platforms) || platforms.length === 0 || platforms.includes(platform)
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
  if (fs.existsSync(path.join(brickRoot, 'package.json'))) installRoot(brickRoot, locals)
  if (platformSupported(brickRoot, currentPlatform())) {
    installRuntime(brickRoot, locals)
    syncPython(brickRoot, locals)
    buildGo(brickRoot, brickId, locals)
    buildCpp(brickRoot, brickId, locals)
    buildDotnet(brickRoot, brickId, locals)
  } else {
    console.log(`skip runtime build（platforms 不含 ${currentPlatform()}）`)
  }
  buildUi(brickRoot, locals)
  stagePreload(brickRoot)
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

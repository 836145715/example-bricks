import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const sourceDir = dirname(fileURLToPath(import.meta.url))
const brickRoot = join(sourceDir, '..', '..')

const targets = {
  'win-x64': { os: 'windows', arch: 'amd64', suffix: '.exe', lib: 'brickly.dll' },
  'win-arm64': { os: 'windows', arch: 'arm64', suffix: '.exe', lib: 'brickly.dll' },
  'mac-x64': { os: 'darwin', arch: 'amd64', suffix: '', lib: 'libbrickly.dylib' },
  'mac-arm64': { os: 'darwin', arch: 'arm64', suffix: '', lib: 'libbrickly.dylib' },
  'linux-x64': { os: 'linux', arch: 'amd64', suffix: '', lib: 'libbrickly.so' },
  'linux-arm64': { os: 'linux', arch: 'arm64', suffix: '', lib: 'libbrickly.so' }
}

function currentPlatform() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)
}

function resolveBricklyHome() {
  if (process.env.BRICKLY_HOME) return resolve(process.env.BRICKLY_HOME)
  const sibling = resolve(brickRoot, '..', '..', 'ai-bricks')
  if (existsSync(join(sibling, 'Brickly', 'packages', 'brickly-sdk-cpp', 'include', 'brickly.hpp'))) {
    return sibling
  }
  return null
}

function run(command, args, options) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${[command, ...args].join(' ')}`)
  }
}

function compiler() {
  for (const name of ['g++', 'c++', 'clang++']) {
    const probe =
      process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/c', 'where', name], { encoding: 'utf8' })
        : spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' })
    if (probe.status === 0) return name
  }
  throw new Error('需要 g++ / clang++ 才能编译 C++ Brick')
}

const platform = process.argv[2] || currentPlatform()
const host = currentPlatform()
if (platform !== host) {
  throw new Error(`C++ runtime 依赖 c-shared，不能在 ${host} 上交叉编译 ${platform}`)
}

const target = targets[platform]
if (!target) throw new Error(`Unknown target: ${platform}`)

const home = resolveBricklyHome()
if (!home) {
  throw new Error('找不到 ai-bricks。C++ SDK 尚未发布，请把 example-bricks 与 ai-bricks 放在同一父目录，或设置 BRICKLY_HOME。')
}

const sdkCpp = join(home, 'Brickly', 'packages', 'brickly-sdk-cpp')
const sdkGo = join(home, 'Brickly', 'packages', 'brickly-sdk-go')
const distBin = join(sdkCpp, 'dist', 'bin')
mkdirSync(distBin, { recursive: true })

if (!existsSync(join(sdkGo, 'capi'))) {
  throw new Error(`缺少 ${sdkGo}/capi`)
}

const sharedLib = join(distBin, target.lib)
const cgoEnv = { ...process.env, CGO_ENABLED: '1' }
if (process.platform === 'darwin') {
  // Go c-shared 默认 install name 是裸文件名。宿主 cwd 是 Brick 根目录，
  // dyld 不会去 runtime/<platform>/ 找；必须打成 @rpath，并在链接时加 @loader_path。
  const flag = '-Wl,-install_name,@rpath/libbrickly.dylib'
  cgoEnv.CGO_LDFLAGS = cgoEnv.CGO_LDFLAGS ? `${cgoEnv.CGO_LDFLAGS} ${flag}` : flag
}
// Windows + Go 1.25 的 c-shared 必须去掉 DWARF，否则 LoadLibrary 返回 193。
run('go', ['build', '-trimpath', '-ldflags', '-s -w', '-buildmode=c-shared', '-o', sharedLib, './capi'], {
  cwd: sdkGo,
  env: cgoEnv
})
const generatedHeader = join(distBin, 'brickly.h')
if (existsSync(generatedHeader)) unlinkSync(generatedHeader)

if (process.platform === 'win32') {
  const defFile = join(sdkCpp, 'brickly.def')
  const implib = join(distBin, 'brickly.dll.a')
  if (existsSync(defFile)) {
    const dlltool = spawnSync('dlltool', ['-d', defFile, '-l', implib, '-D', 'brickly.dll'], { stdio: 'inherit' })
    if (dlltool.status !== 0 && !existsSync(implib)) {
      throw new Error('dlltool 未能生成 brickly.dll.a，无法链接 brickly.dll')
    }
  }
}

const cxx = compiler()
const output = join(brickRoot, 'runtime', platform, `brick${target.suffix}`)
mkdirSync(dirname(output), { recursive: true })

const args = ['-std=c++17', join(sourceDir, 'main.cpp'), `-I${sourceDir}`, `-I${join(sdkCpp, 'include')}`, `-L${distBin}`, '-lbrickly', '-o', output]
if (process.platform === 'win32' || process.platform === 'linux') {
  args.splice(1, 0, '-static-libgcc', '-static-libstdc++')
}
if (process.platform === 'linux') args.push('-Wl,-rpath,$ORIGIN')
if (process.platform === 'darwin') args.push('-Wl,-rpath,@loader_path')

console.log(`Building ${platform} -> ${output}`)
run(cxx, args, { cwd: sourceDir, env: { ...process.env, CGO_ENABLED: '1' } })
copyFileSync(sharedLib, join(dirname(output), target.lib))
console.log(`copied ${target.lib}`)

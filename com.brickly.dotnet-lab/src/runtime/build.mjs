import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const sourceDir = dirname(fileURLToPath(import.meta.url))
const brickRoot = join(sourceDir, '..', '..')

function currentPlatform() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)
}

const platform = process.argv[2] || currentPlatform()

// 契约约定：输出目录优先取宿主注入的 BRICKLY_BUILD_OUT（暂存段），
// 手动执行时兜底 <砖根>/out/runtime/<platform>。csproj AssemblyName=brick → brick[.exe]。
const outDir = process.env.BRICKLY_BUILD_OUT ?? join(brickRoot, 'out', 'runtime', platform)
mkdirSync(outDir, { recursive: true })

console.log(`dotnet publish ${platform} -> ${outDir}`)
const result = spawnSync('dotnet', ['publish', '-c', 'Release', '-o', outDir, '--nologo'], {
  cwd: sourceDir,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`dotnet publish failed (${result.status})`)

// dotnet 固定把 bin/obj 中间产物写在 csproj 旁，与 -o 无关；清掉避免污染源码树
// （注意 src/runtime/bin 是契约保留的预构建目录名，但此处是 dotnet 自己的 Release 产物，形态不同）
rmSync(join(sourceDir, 'bin'), { recursive: true, force: true })
rmSync(join(sourceDir, 'obj'), { recursive: true, force: true })

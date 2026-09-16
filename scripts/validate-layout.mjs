/**
 * 全量布局校验：对本仓库每个砖跑 @syllm/brick-contract 的 inspectSourceTree。
 * 复用 ai-bricks 兄弟仓已构建的契约包（与根 sync 脚本同一约定：两仓相邻检出）。
 * 先在 ai-bricks/Brickly 跑 `npm run deps:build` 生成 dist 再运行本脚本。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractEntry = join(repoRoot, '..', 'ai-bricks', 'Brickly', 'packages', 'brick-contract', 'dist', 'index.js')
if (!existsSync(contractEntry)) {
  console.error(`缺少契约构建产物：${contractEntry}`)
  console.error('请先在 ai-bricks/Brickly 执行 npm run deps:build')
  process.exit(1)
}
const { inspectSourceTree } = await import(pathToFileURL(contractEntry).href)

// 收集砖根相对 posix 路径；node_modules/out/dist 对源码识别无意义且拖慢遍历
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.venv', 'target'])
function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const rel = base ? base + '/' + name : name
    if (statSync(p).isDirectory()) walk(p, rel, out)
    else out.push(rel)
  }
  return out
}

let pass = 0
let fail = 0
for (const name of readdirSync(repoRoot).sort()) {
  const dir = join(repoRoot, name)
  if (!statSync(dir).isDirectory()) continue
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) continue

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    console.log(`FAIL ${name}  manifest 解析失败：${error.message}`)
    fail++
    continue
  }

  const result = inspectSourceTree(walk(dir, '', []), {
    runtimeType: manifest.runtime?.type,
    uiType: manifest.ui?.type,
    preload: typeof manifest.preload === 'string' ? manifest.preload : undefined
  })

  if (result.errors.length) {
    fail++
    console.log(`FAIL ${name}`)
    for (const issue of result.errors) console.log(`     ${issue.code} @ ${issue.path}`)
  } else {
    pass++
    console.log(`ok   ${name}  ui=${result.uiKind} runtime=${result.runtimeSource ?? '-'} preload=${result.hasPreload} bin=${result.hasPrebuiltBin}`)
  }
}
console.log(`\n==== ${pass} pass / ${fail} fail ====`)
process.exit(fail ? 1 : 0)

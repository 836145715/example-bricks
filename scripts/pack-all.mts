/**
 * 批量打包 example-bricks 为源码归档（与开发工作台"打包"一致，mode=source）。
 * 复用 ai-bricks/Brickly 的 BrickPackager，输出到 example-bricks/dist。
 *
 * 运行（在 ai-bricks/Brickly 下用其 tsx 执行）：
 *   cd D:\test1\brick-project\ai-bricks\Brickly
 *   node_modules\.bin\tsx.cmd D:\test1\brick-project\example-bricks\scripts\pack-all.mts
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import brickPackagerModule from '../../ai-bricks/Brickly/src/main/dev-workspace/brick-packager.ts'
const { BrickPackager } = brickPackagerModule as typeof import('../../ai-bricks/Brickly/src/main/dev-workspace/brick-packager.ts')

const bricksRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(bricksRoot, 'dist')
const packager = new BrickPackager(outputDir)

const failures: { brick: string; reason: string }[] = []
const results: string[] = []

for (const name of readdirSync(bricksRoot).sort()) {
  const brickDir = join(bricksRoot, name)
  if (!statSync(brickDir).isDirectory()) continue
  if (!existsSync(join(brickDir, 'manifest.json'))) continue

  const preview = await packager.package(brickDir, { mode: 'source' })
  if (preview.errors.length > 0) {
    failures.push({ brick: name, reason: preview.errors.join('; ') })
    console.error(`FAILED ${name}: ${preview.errors.join('; ')}`)
    continue
  }
  for (const warning of preview.warnings) console.warn(`WARN  ${name}: ${warning}`)
  results.push(
    `${name}@${preview.version} -> ${preview.packagePath} (${preview.packageSize} bytes, ` +
      `included=${preview.includedCount}, excluded=${preview.excludedCount}, sha256=${preview.packageSha256.slice(0, 12)}…)`
  )
  console.log(`OK    ${name}`)
}

console.log(`\n${results.length} bricks packed into ${outputDir}`)
if (failures.length > 0) {
  console.error(`${failures.length} bricks failed`)
  process.exit(1)
}

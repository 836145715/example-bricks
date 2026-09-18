/**
 * 把 create-brickly 的构建产物 vendor 进本砖 src/runtime/vendor/create-brickly/。
 * 来源优先级：BRICKLY_CREATE_BRICKLY 环境变量 → 兄弟仓库 ../ai-bricks（与 setup-brick 的
 * BRICKLY_HOME 约定一致）。create-brickly 未发布 npm 期间，bundle 是唯一合法消费方式；
 * 发布后改为 npm 依赖 pin，本脚本随之退役。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const brickRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const createDir =
  process.argv[2] ??
  process.env.BRICKLY_CREATE_BRICKLY ??
  resolve(brickRoot, '..', '..', 'ai-bricks', 'Brickly', 'packages', 'create-brickly')

const vendorDir = join(brickRoot, 'src', 'runtime', 'vendor', 'create-brickly')
const copies = [
  [join(createDir, 'dist', 'api.js'), join(vendorDir, 'api.js')],
  [
    join(createDir, 'schema', 'manifest.schema.json'),
    join(vendorDir, 'schema', 'manifest.schema.json')
  ],
  // UI 侧 Monaco JSON 诊断用同一份 schema
  [
    join(createDir, 'schema', 'manifest.schema.json'),
    join(brickRoot, 'src', 'ui', 'vendor', 'manifest.schema.json')
  ]
]

for (const [from] of copies) {
  if (!existsSync(from)) {
    throw new Error(`找不到 ${from}。先在 create-brickly 目录跑 npm run build，或设置 BRICKLY_CREATE_BRICKLY。`)
  }
}
for (const [from, to] of copies) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  console.log(`vendored ${from} -> ${to}`)
}

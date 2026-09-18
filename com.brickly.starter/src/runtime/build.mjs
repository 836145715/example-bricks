/**
 * node runtime 约定构建脚本：esbuild 把 index.ts 连同 @syllm/brickly-sdk 与 vendored
 * create-brickly api.js 全部 inline 成单文件 <BRICKLY_BUILD_OUT>/index.js（契约入口名）。
 * vendor/create-brickly/schema 仍按文件消费——宿主 stageRuntime 会把 src/runtime 整棵
 * 拷到 out 段，运行时通过 manifestSchemaPath 显式定位。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.env.BRICKLY_BUILD_OUT
if (!outDir) {
  throw new Error('缺少 BRICKLY_BUILD_OUT 输出目录（由宿主构建管线或 setup-brick.cjs 注入）')
}
mkdirSync(outDir, { recursive: true })

// 构建工具自举：源码树被拷到无依赖环境（审核构建沙箱）时向上找不到 node_modules，
// 先按 package.json 声明落地；已装过则跳过。
if (!existsSync(join(here, 'node_modules'))) {
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: here,
    stdio: 'inherit',
    shell: true
  })
  if (install.status !== 0) throw new Error('src/runtime 构建依赖安装失败')
}
const { build: esbuild } = await import('esbuild')
await esbuild({
  entryPoints: [resolve(here, 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: resolve(outDir, 'index.js'),
  // Electron-as-Node 环境：内建模块保持 external，其余全部 inline
  packages: 'bundle',
  sourcemap: false,
  minify: false,
  logLevel: 'info'
})

#!/usr/bin/env node
'use strict'

/**
 * 跑「依赖宿主源码」的 .ts 测试（ BrickProcess / HostGrpcServer 等内部模块）。
 * tsx 不重复安装——借用宿主仓 node_modules 里的那份（与 test-resource-lab.ps1 同法）。
 * 用法：node scripts/run-host-test.cjs <test-file> [更多 test 文件...]
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

function resolveHostRoot() {
  if (process.env.BRICKLY_HOST_ROOT) return path.resolve(process.env.BRICKLY_HOST_ROOT)
  const home = process.env.BRICKLY_HOME
    ? path.resolve(process.env.BRICKLY_HOME)
    : path.resolve(root, '..', 'ai-bricks')
  return path.join(home, 'Brickly')
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('用法: node scripts/run-host-test.cjs <test-file> [...]')
  process.exit(1)
}

const hostRoot = resolveHostRoot()
const tsxCli = path.join(hostRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
if (!fs.existsSync(tsxCli)) {
  console.error(
    `找不到宿主 tsx：${tsxCli}\n` +
      '先在 ai-bricks/Brickly 装依赖（npm ci），或设置 BRICKLY_HOME / BRICKLY_HOST_ROOT。'
  )
  process.exit(1)
}

const result = spawnSync(process.execPath, [tsxCli, '--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, BRICKLY_HOST_ROOT: hostRoot }
})
process.exit(result.status ?? 1)

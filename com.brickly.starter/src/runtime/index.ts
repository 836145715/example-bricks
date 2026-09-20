/**
 * com.brickly.starter runtime：create-brickly 内核的 GUI 薄壳。
 * 生成逻辑全部来自 vendored api.js（CLI 构建产物），本层只做三件事：
 *   1. 把向导输入转成 CreateStarterDraft 并做边界校验；
 *   2. 通过 ctx.platform.dev.* + brick.getPath('devBricks') 取宿主开发目录原语
 *      （列表 / 详情 / 目录路径 / rescan）；
 *   3. create 前对依赖引用做终校验（快照可能已过期）。
 */
import { join } from 'node:path'
import { BppError, BricklyRuntime, type BrickRef } from '@syllm/brickly-sdk'
import {
  ALL_PLATFORMS,
  createStarterProject,
  previewStarterFiles,
  STARTER_FEATURE_PRESETS,
  STARTER_RUNTIMES,
  STARTER_UI_STACKS,
  type CreateStarterDraft
} from './vendor/create-brickly/api.js'

const brick = new BricklyRuntime()

// stageRuntime 把 src/runtime 整棵拷到 out/runtime/<platform>，schema 按文件随行。
const MANIFEST_SCHEMA = join(
  __dirname,
  'vendor',
  'create-brickly',
  'schema',
  'manifest.schema.json'
)

function requireDraft(input: unknown): CreateStarterDraft {
  const draft = (input as { draft?: unknown } | undefined)?.draft ?? input
  if (!draft || typeof draft !== 'object') {
    throw new BppError('INVALID_INPUT', '缺少 draft 输入')
  }
  const d = draft as CreateStarterDraft
  if (!d.brickId || !d.name || !d.authorName) {
    throw new BppError('INVALID_INPUT', 'draft 缺少必填字段：brickId / name / authorName')
  }
  return d
}

function requireRef(input: unknown): BrickRef {
  const ref = (input as { ref?: unknown } | undefined)?.ref ?? input
  const r = ref as Partial<BrickRef> | undefined
  if (!r?.brickId || !r.origin || !r.version) {
    throw new BppError('INVALID_INPUT', '需要完整 BrickRef：{ brickId, origin, version }')
  }
  return r as BrickRef
}

brick.onCommand('list-templates', async () => ({
  runtimes: STARTER_RUNTIMES,
  uiStacks: STARTER_UI_STACKS,
  featurePresets: STARTER_FEATURE_PRESETS,
  platforms: ALL_PLATFORMS,
  defaults: {
    runtime: 'node',
    uiStack: 'react-vite-ts',
    featurePreset: 'full',
    version: '0.1.0',
    apiVersion: '>=0.1.0 <1.0.0'
  }
}))

brick.onCommand('list-bricks', async (ctx) => ctx.platform.dev.listBricks())

brick.onCommand('get-brick-detail', async (ctx, input) =>
  ctx.platform.dev.getBrickDetail(requireRef(input))
)

brick.onCommand('preview', async (_ctx, input) =>
  previewStarterFiles({
    draft: requireDraft(input),
    platforms: 'current',
    manifestSchemaPath: MANIFEST_SCHEMA
  })
)

brick.onCommand('create', async (ctx, input) => {
  const draft = requireDraft(input)

  // 依赖引用终校验：向导加载的列表是旧快照，落盘前重新拉取
  const missing: string[] = []
  for (const dep of draft.toolDependencies ?? []) {
    const detail = await ctx.platform.dev.getBrickDetail({
      brickId: dep.brickId,
      origin: dep.origin as BrickRef['origin'],
      version: dep.version
    })
    if (!detail) missing.push(`${dep.brickId}@${dep.version} (${dep.origin})`)
  }
  if (missing.length) {
    throw new BppError('BRICK_NOT_FOUND', `依赖工具已不存在，请重新选择：${missing.join(', ')}`)
  }

  const bricksDir = await brick.getPath('devBricks')
  const destDir = join(bricksDir, draft.brickId)
  const result = createStarterProject({
    draft,
    destDir,
    platforms: 'current',
    manifestSchemaPath: MANIFEST_SCHEMA
  })
  const rescan = await ctx.platform.dev.rescan()
  return { ...result, rescan }
})

brick.start()

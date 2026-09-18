/**
 * com.brickly.starter runtime 冒烟测试：
 * 真 spawn 构建产物 out/runtime/<platform>/index.js，通过 HostGrpcServer 注入 fake
 * platform.dev handler，验证三件事：
 *   ① preview 命令走 vendored create-brickly 内核返回文件树 + manifest（纯库路径）；
 *   ② create 命令把生成物写进 fake bricksDir 并触发 rescan（端到端落盘链路）；
 *   ③ 依赖引用指向不存在的 BrickRef 时 create 以 BRICK_NOT_FOUND 拒绝（终校验）。
 * 运行前置：node scripts/setup-brick.cjs --local com.brickly.starter（产物 + SDK 就位）。
 * 宿主源码解析：BRICKLY_HOST_ROOT > BRICKLY_HOME > ../ai-bricks（同 setup-brick 约定）。
 * 运行：npm run test:starter
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brickRoot = join(repoRoot, 'com.brickly.starter')

function resolveHostRoot(): string {
  if (process.env.BRICKLY_HOST_ROOT) return resolve(process.env.BRICKLY_HOST_ROOT)
  const home = process.env.BRICKLY_HOME
    ? resolve(process.env.BRICKLY_HOME)
    : resolve(repoRoot, '..', 'ai-bricks')
  return join(home, 'Brickly')
}

const hostRoot = resolveHostRoot()
if (!existsSync(join(hostRoot, 'src', 'main', 'runtime', 'brick-process.ts'))) {
  throw new Error(
    `找不到宿主源码 ${hostRoot}；把 example-bricks 和 ai-bricks 放同一父目录，` +
      '或设置 BRICKLY_HOME（ai-bricks 根）/ BRICKLY_HOST_ROOT（Brickly 目录）'
  )
}

function importHost(relativePath: string): Promise<any> {
  return import(pathToFileURL(join(hostRoot, relativePath)).href)
}

const DRAFT = {
  runtime: 'node',
  uiStack: 'react-vite-ts',
  featurePreset: 'minimal',
  brickId: 'com.example.smoke-target',
  name: 'Smoke Target',
  authorName: 'smoke-test'
}

const FAKE_BRICK = {
  brickId: 'com.example.dep',
  name: 'Dep Tool',
  version: '1.0.0',
  origin: 'development',
  valid: true,
  flags: { hasUi: false, hasCommands: true, hasRuntime: true, hasDependencies: false }
}

async function collect(proc: any, command: string, input: unknown) {
  const events: Array<{ type: string; result?: unknown; error?: { code?: string; message?: string } }> = []
  for await (const event of proc.invoke(command, input, {
    invocationContext: {
      id: `smoke-${command}-${Date.now()}`,
      rootId: 'smoke-root',
      triggerKind: 'host-command',
      signal: new AbortController().signal
    }
  })) {
    events.push(event as (typeof events)[number])
  }
  return events
}

test(
  'starter runtime：preview/create/依赖终校验全链路',
  { timeout: 60_000 },
  async () => {
    const [{ BrickProcess }, { HostGrpcServer }, { currentPlatformKey }] = await Promise.all([
      importHost('src/main/runtime/brick-process.ts'),
      importHost('src/main/runtime/transport/host-grpc-server.ts'),
      importHost('src/main/runtime/platform.ts')
    ])
    const platform = currentPlatformKey() ?? 'win-x64'
    const entry = join(brickRoot, 'out', 'runtime', platform, 'index.js')
    if (!existsSync(entry)) {
      throw new Error(`缺少构建产物 ${entry}，先运行 setup-brick 构建本砖`)
    }

    const bricksDir = mkdtempSync(join(tmpdir(), 'starter-smoke-'))
    const calls: string[] = []
    const host = new HostGrpcServer()
    host.setPlatformHandler({
      dev: {
        bricksDir: () => {
          calls.push('bricksDir')
          return { path: bricksDir }
        },
        listBricks: () => {
          calls.push('listBricks')
          return [FAKE_BRICK]
        },
        getBrickDetail: (_caller: unknown, ref: { brickId: string }) => {
          calls.push(`getBrickDetail:${ref.brickId}`)
          return ref.brickId === FAKE_BRICK.brickId
            ? { ...FAKE_BRICK, manifest: { commands: [{ id: 'ping', name: 'Ping' }] } }
            : null
        },
        rescan: () => {
          calls.push('rescan')
          return { bricks: [FAKE_BRICK] }
        }
      }
    })

    const manifest = {
      manifestVersion: 1,
      kind: 'brick',
      id: 'com.brickly.starter',
      version: '0.1.0',
      apiVersion: '>=0.1.0 <1.0.0',
      name: 'Starter',
      author: 'test',
      runtime: {
        type: 'node',
        instance: 'per-call',
        platforms: [platform],
        entry: { [platform]: `runtime/${platform}/index.js` }
      },
      trustLevel: 'community',
      ui: { type: 'webview' },
      commands: [
        'list-templates',
        'list-bricks',
        'get-brick-detail',
        'preview',
        'create'
      ].map((id) => ({ id, name: id, io: { inputs: [], outputs: [] } })),
      manifestPath: join(brickRoot, 'manifest.json'),
      rootDir: brickRoot,
      authoringRoot: brickRoot,
      loadRoot: join(brickRoot, 'out'),
      loadState: 'runnable',
      origin: 'development',
      valid: true,
      flags: { hasUi: true, hasCommands: true, hasRuntime: true, hasDependencies: false }
    }

    const proc = new BrickProcess({ manifest, instanceId: 'starter-smoke', grpcHost: host })
    try {
      await proc.start()

      // ① list-bricks 转发 platform.dev.listBricks
      const listEvents = await collect(proc, 'list-bricks', {})
      const listResult = listEvents.find((e) => e.type === 'result')?.result as Array<{
        brickId: string
      }>
      assert.equal(listResult?.[0]?.brickId, FAKE_BRICK.brickId)

      // ② preview：纯库路径，不落盘
      const previewEvents = await collect(proc, 'preview', { draft: DRAFT })
      const preview = previewEvents.find((e) => e.type === 'result')?.result as {
        manifest: { id?: string }
        fileTree: Array<{ path: string }>
      }
      assert.equal(preview.manifest.id, DRAFT.brickId)
      assert.ok(preview.fileTree.some((f) => f.path === 'manifest.json'))
      assert.ok(!existsSync(join(bricksDir, DRAFT.brickId)), 'preview 不应落盘')

      // ③ create：写进 fake bricksDir 并触发 rescan
      const createEvents = await collect(proc, 'create', { draft: DRAFT })
      const created = createEvents.find((e) => e.type === 'result')?.result as {
        destDir: string
        createdFiles: string[]
        rescan: { bricks: unknown[] }
      }
      assert.equal(created.destDir, join(bricksDir, DRAFT.brickId))
      assert.ok(created.createdFiles.includes('manifest.json'))
      assert.ok(calls.includes('bricksDir') && calls.includes('rescan'))
      const writtenManifest = JSON.parse(
        readFileSync(join(bricksDir, DRAFT.brickId, 'manifest.json'), 'utf8')
      )
      assert.equal(writtenManifest.id, DRAFT.brickId)

      // ④ 依赖终校验：不存在的 BrickRef → BRICK_NOT_FOUND，不落盘
      const badDraft = {
        ...DRAFT,
        brickId: 'com.example.smoke-bad',
        toolDependencies: [
          { alias: 'gone', brickId: 'com.example.gone', origin: 'development', version: '9.9.9' }
        ]
      }
      const badEvents = await collect(proc, 'create', { draft: badDraft })
      const err = badEvents.find((e) => e.type === 'error')?.error
      // 命令错误的线上 code 是 gRPC 状态名；BPP 业务码不冒泡，断言错误内容即可
      assert.match(err?.message ?? '', /依赖工具已不存在.*com\.example\.gone/)
      assert.ok(!existsSync(join(bricksDir, 'com.example.smoke-bad')), '校验失败不应落盘')
    } finally {
      await proc.close(true)
      await host.close()
      rmSync(bricksDir, { recursive: true, force: true })
    }
  }
)

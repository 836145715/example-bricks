/**
 * com.brickly.quick-search runtime 冒烟测试：
 * 真 spawn 构建产物 out/runtime/<platform>/index.js（ELECTRON_RUN_AS_NODE 路径），
 * 验证 ① 进程经 gRPC 注册就绪 ② `toggle` 命令到达 runtime（UI 调用在测试宿主里
 * 没有真窗口后端，预期以平台错误返回——证明命令路由已通）。
 * 运行前置：先 `node scripts/setup-brick.cjs --local com.brickly.quick-search`
 * （或发布态 setup），让 out/ 产物与 SDK 依赖就位。
 * 宿主源码解析：BRICKLY_HOST_ROOT（指向 Brickly 目录）或 BRICKLY_HOME /
 * 旁边 ../ai-bricks（与 setup-brick.cjs 同一约定）。
 * 运行：npm run test:quick-search
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brickRoot = join(repoRoot, 'com.brickly.quick-search')

/** 与 scripts/setup-brick.cjs 同一套宿主定位：BRICKLY_HOST_ROOT > BRICKLY_HOME > ../ai-bricks */
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

test('quick-search runtime 能启动注册并接收 toggle 命令', { timeout: 30_000 }, async () => {
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
  const host = new HostGrpcServer()
  const manifest = {
    manifestVersion: 1,
    kind: 'brick',
    id: 'com.brickly.quick-search',
    version: '0.1.0',
    apiVersion: '>=0.1.0 <1.0.0',
    name: 'Quick Search',
    author: 'test',
    runtime: {
      type: 'node',
      instance: 'shared',
      resident: true,
      platforms: [platform],
      entry: { [platform]: `runtime/${platform}/index.js` }
    },
    trustLevel: 'community',
    ui: { type: 'none' },
    commands: [{ id: 'toggle', name: 'Toggle', io: { inputs: [], outputs: [] } }],
    quickSearch: { consumer: { providers: '*', reason: 'test' } },
    manifestPath: join(brickRoot, 'manifest.json'),
    rootDir: brickRoot,
    authoringRoot: brickRoot,
    loadRoot: join(brickRoot, 'out'),
    loadState: 'runnable',
    origin: 'development',
    valid: true,
    flags: { hasUi: false, hasCommands: true, hasRuntime: true, hasDependencies: false }
  }
  const proc = new BrickProcess({ manifest, instanceId: 'qs-smoke', grpcHost: host })
  try {
    await proc.start()
    const events: Array<{ type: string; error?: { code?: string; message?: string } }> = []
    for await (const event of proc.invoke('toggle', null, {
      invocationContext: {
        id: 'qs-smoke-toggle-1',
        rootId: 'qs-smoke-toggle-1',
        triggerKind: 'host-command',
        signal: new AbortController().signal
      }
    })) {
      events.push(event as { type: string; error?: { code?: string; message?: string } })
    }
    const errorEvent = events.find((event) => event.type === 'error')
    // toggle 会调 ui.window.create——测试宿主没有真窗口后端，预期平台错误。
    // 命令到达 runtime 即链路验证完成；result 终态（如真创建成功）同样接受。
    if (errorEvent) {
      assert.match(
        `${errorEvent.error?.code ?? ''} ${errorEvent.error?.message ?? ''}`,
        /ui\.window\.create|未接入|UNAVAILABLE|INTERNAL/i
      )
    }
    assert.ok(events.length > 0, 'invoke 应至少产出一个终态事件')
  } finally {
    await proc.close(true)
    await host.close()
  }
})

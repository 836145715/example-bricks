import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostRoot = resolve(process.env.BRICKLY_HOST_ROOT ?? 'D:\\brick-project\\ai-bricks\\Brickly')
const labId = 'com.brickly.resource-lab'
const brickIds = [
  labId,
  'com.brickly.resource-echo-node',
  'com.brickly.resource-echo-python',
  'com.brickly.resource-echo-go'
]

test('真实 Host 装载 Resource Lab 四个 Brick 并通过默认套件', { timeout: 180_000 }, async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'brickly-resource-lab-host-e2e-'))
  let host: any
  try {
    const bricksDir = join(rootDir, 'bricks')
    await prepareBricks(bricksDir)
    const [hostModule, registryModule, brokerModule, configModule, lifecycleModule] = await Promise.all([
      importHost('src/main/host/brickly-host.ts'),
      importHost('src/main/registry/brick-registry.ts'),
      importHost('src/main/resources/resource-broker.ts'),
      importHost('src/main/config/brick-config-store.ts'),
      importHost('src/main/resources/resource-lifecycle.ts')
    ])
    const registry = new registryModule.BrickRegistry(join(rootDir, 'development-bricks'))
    registry.setAdditionalBrickRoots(brickIds.map((id) => join(bricksDir, id)))
    const loaded = registry.reload()
    assert.deepEqual(
      loaded.map((brick: any) => ({ id: brick.id, valid: brick.valid, errors: brick.errors })).sort((left: any, right: any) => left.id.localeCompare(right.id)),
      brickIds.slice().sort().map((id) => ({ id, valid: true, errors: undefined }))
    )
    const resourceDir = join(rootDir, 'resources')
    await lifecycleModule.cleanupResourceStorageOnStartup(resourceDir, 1_000)
    const broker = new brokerModule.ResourceBroker({
      directory: resourceDir,
      cleanupIntervalMs: 60_000,
      minFreeDiskBytes: 1
    })
    host = hostModule.createBricklyHost({
      registry,
      resourceBroker: broker,
      configStore: new configModule.BrickConfigStore(join(rootDir, 'configs')),
      runtimeStateDir: join(rootDir, 'runtime-state')
    })
    await host.startService(labId)
    for (const brickId of brickIds.filter((id) => id !== labId)) {
      await invokeBrick(host, brickId, 'event-last', {})
    }

    const runId = `host-e2e-${Date.now()}`
    const selectedIds = process.env.RESOURCE_LAB_E2E_IDS?.split(',').map((value) => value.trim()).filter(Boolean)
    await invoke(host, 'suite-run', selectedIds?.length ? { runId, ids: selectedIds } : { runId, mode: 'default' })
    const snapshot = await waitForRun(host, runId)
    const unsuccessful = snapshot.results.filter((result: any) => result.status !== 'passed')
    assert.equal(snapshot.status, 'passed', JSON.stringify({ status: snapshot.status, unsuccessful }, null, 2))
    assert.equal(unsuccessful.length, 0, JSON.stringify(unsuccessful, null, 2))
    if (!selectedIds?.length) {
      assert.ok(snapshot.results.length >= 20)
      assert.ok(snapshot.results.some((result: any) => result.scenarioId === 'relay-node-python-go'))
      assert.ok(snapshot.results.some((result: any) => result.scenarioId === 'event-resource-handle'))
      assert.equal(snapshot.results.some((result: any) => result.scenarioId === 'restart-runtime-recovery'), false)

      const cancelRunId = `host-e2e-cancel-${Date.now()}`
      const abort = new AbortController()
      const startedAt = Date.now()
      const cancelledRun = invoke(host, 'suite-run', { runId: cancelRunId, ids: ['resource-ttl'] }, abort.signal)
      await waitUntil(() => invoke(host, 'suite-status', { runId: cancelRunId }).then((value: any) => value.status === 'running'))
      abort.abort('host-e2e-cancel')
      await assert.rejects(cancelledRun, { code: 'CANCELLED' })
      const cancelledSnapshot: any = await waitForRun(host, cancelRunId)
      assert.equal(cancelledSnapshot.status, 'cancelled')
      assert.ok(Date.now() - startedAt < 5_000, '取消 TTL 场景应在 5 秒内完成')

      const commandCancelRunId = `host-e2e-command-cancel-${Date.now()}`
      const commandRun: Promise<any> = invoke(host, 'suite-run', {
        runId: commandCancelRunId,
        ids: ['cancel-child-invoke']
      }) as Promise<any>
      await waitUntil(() => invoke(host, 'suite-status', { runId: commandCancelRunId }).then((value: any) => value.status === 'running'))
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      const commandCancelStartedAt = Date.now()
      const commandCancelled: any = await invoke(host, 'suite-cancel', { runId: commandCancelRunId })
      const commandRunResult = await commandRun
      assert.equal(commandCancelled.status, 'cancelled')
      assert.equal(commandRunResult.status, 'cancelled')
      assert.equal(commandCancelled.results[0]?.childCleanupCompleted, true)
      assert.equal(commandCancelled.results[0]?.childCancelled, true)
      assert.ok(Date.now() - commandCancelStartedAt < 3_000, 'suite-cancel 应在 3 秒内中止慢速 child')
    }
  } finally {
    await host?.shutdown().catch(() => undefined)
    await rm(rootDir, { recursive: true, force: true })
  }
})

async function prepareBricks(bricksDir: string): Promise<void> {
  await mkdir(bricksDir, { recursive: true })
  for (const brickId of brickIds) {
    const source = join(repoRoot, brickId)
    const target = join(bricksDir, brickId)
    await cp(source, target, {
      recursive: true,
      filter: (path) => !['node_modules', 'test-results', '.venv'].includes(basename(path))
    })
  }
  for (const brickId of [labId, 'com.brickly.resource-echo-node']) {
    const sourceModules = join(repoRoot, brickId, 'runtime', 'node', 'node_modules')
    const targetModules = join(bricksDir, brickId, 'runtime', 'node', 'node_modules')
    await symlink(sourceModules, targetModules, process.platform === 'win32' ? 'junction' : 'dir')
  }

  const pythonRoot = join(bricksDir, 'com.brickly.resource-echo-python')
  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  const uv = join(hostRoot, 'resources', 'runtimes', platformKey, process.platform === 'win32' ? 'uv.exe' : 'uv')
  await execFileAsync(uv, ['venv', '.venv', '--python', '3.12', '--no-project', '--no-python-downloads'], {
    cwd: pythonRoot,
    windowsHide: true
  })
  const pythonExecutable = process.platform === 'win32'
    ? join(pythonRoot, '.venv', 'Scripts', 'python.exe')
    : join(pythonRoot, '.venv', 'bin', 'python')
  await execFileAsync(uv, [
    'pip', 'install', '--python', pythonExecutable,
    join(hostRoot, 'packages', 'brickly-sdk-python')
  ], { cwd: pythonRoot, windowsHide: true })
  const [{ stdout: versionOutput }, requirements] = await Promise.all([
    execFileAsync(pythonExecutable, ['--version'], { windowsHide: true }),
    readFile(join(pythonRoot, 'requirements.txt'))
  ])
  const pythonVersion = versionOutput.match(/(\d+\.\d+\.\d+)/)?.[1]
  assert.ok(pythonVersion, `无法解析 Python 版本：${versionOutput}`)
  await writeFile(join(pythonRoot, '.brickly-installed.json'), JSON.stringify({
    depsHash: createHash('sha256').update(requirements).digest('hex'),
    pythonVersion
  }))
}

async function waitForRun(host: any, runId: string): Promise<any> {
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const snapshot = await invoke(host, 'suite-status', { runId })
    if (snapshot.status !== 'running') return snapshot
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Resource Lab 默认套件超时：${runId}`)
}

function invoke(host: any, commandId: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  return invokeBrick(host, labId, commandId, input, signal)
}

function invokeBrick(host: any, brickId: string, commandId: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  return host.invocationGateway.submit({
    kind: 'host-command',
    caller: { label: 'resource-lab-host-e2e' },
    target: { brickId, commandId, origin: 'installed' },
    input,
    ...(signal ? { signal } : {})
  })
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('等待 Resource Lab 状态超时')
}

function importHost(relativePath: string): Promise<any> {
  return import(pathToFileURL(join(hostRoot, relativePath)).href)
}

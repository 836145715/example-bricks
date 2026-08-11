const assert = require('node:assert/strict')
const test = require('node:test')

const { RunManager, SkipScenario } = require('./run-manager.cjs')

test('RunManager 限制并发为 3 且 exclusive 场景单独运行', async () => {
  let active = 0
  let maxActive = 0
  const exclusiveSnapshots = []
  const gates = new Map()
  const manager = new RunManager({
    maxParallel: 3,
    executeScenario: async (scenario) => {
      active++
      maxActive = Math.max(maxActive, active)
      if (scenario.exclusive) exclusiveSnapshots.push(active)
      await new Promise((resolve) => gates.set(scenario.id, resolve))
      active--
      return { scenarioId: scenario.id }
    }
  })
  const scenarios = [
    item('a'), item('b'), item('c'), item('exclusive', true), item('d'), item('e')
  ]
  manager.start({ runId: 'run-concurrency', scenarios })
  await waitUntil(() => gates.size === 3)
  gates.get('a')(); gates.get('b')(); gates.get('c')()
  await waitUntil(() => gates.has('exclusive'))
  assert.deepEqual(exclusiveSnapshots, [1])
  gates.get('exclusive')()
  await waitUntil(() => gates.has('d') && gates.has('e'))
  gates.get('d')(); gates.get('e')()
  const run = await manager.wait('run-concurrency')
  assert.equal(maxActive, 3)
  assert.equal(run.status, 'passed')
})

test('RunManager 单项完成立即通知且依赖缺失标记 skipped', async () => {
  const updates = []
  const manager = new RunManager({
    executeScenario: async (scenario) => {
      if (scenario.id === 'skip') throw new SkipScenario('dependency unavailable')
      return { ok: true }
    },
    onUpdate: (snapshot) => updates.push(snapshot)
  })
  manager.start({ runId: 'run-updates', scenarios: [item('pass'), item('skip')] })
  const run = await manager.wait('run-updates')
  assert.equal(run.results.find((result) => result.scenarioId === 'pass').status, 'passed')
  assert.equal(run.results.find((result) => result.scenarioId === 'skip').status, 'skipped')
  assert.ok(updates.some((snapshot) => snapshot.results.some((result) => result.status === 'passed')))
})

test('按 runId 取消不会影响另一个批次并等待场景清理', async () => {
  const cleaned = new Set()
  const manager = new RunManager({
    executeScenario: async (scenario, context) => {
      await new Promise((resolve) => context.signal.addEventListener('abort', resolve, { once: true }))
      await new Promise((resolve) => setTimeout(resolve, 10))
      cleaned.add(scenario.id)
      const error = new Error('cancelled')
      error.code = 'CANCELLED'
      throw error
    }
  })
  manager.start({ runId: 'run-a', scenarios: [item('a')] })
  manager.start({ runId: 'run-b', scenarios: [item('b')] })
  await waitUntil(() => manager.status('run-a').status === 'running')
  await manager.cancel('run-a')
  assert.equal(cleaned.has('a'), true)
  assert.equal(manager.status('run-a').status, 'cancelled')
  assert.equal(manager.status('run-b').status, 'running')
  await manager.cancel('run-b')
})

test('多个 run 共用全局并发上限且 exclusive 场景全局独占', async () => {
  let active = 0
  let maxActive = 0
  const exclusiveActive = []
  const gates = new Map()
  const manager = new RunManager({
    maxParallel: 3,
    executeScenario: async (scenario) => {
      active++
      maxActive = Math.max(maxActive, active)
      if (scenario.exclusive) exclusiveActive.push(active)
      await new Promise((resolve) => gates.set(scenario.id, resolve))
      active--
      return {}
    }
  })

  manager.start({ runId: 'run-a', scenarios: [item('a1'), item('a2'), item('exclusive', true)] })
  manager.start({ runId: 'run-b', scenarios: [item('b1'), item('b2'), item('b3')] })
  await waitUntil(() => gates.size === 3)
  assert.equal(active, 3)
  const released = new Set()
  while (!gates.has('exclusive')) {
    for (const [id, resolve] of gates) {
      if (id !== 'exclusive' && !released.has(id)) {
        released.add(id)
        resolve()
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await waitUntil(() => gates.has('exclusive'))
  assert.deepEqual(exclusiveActive, [1])
  gates.get('exclusive')()
  for (const [id, resolve] of gates) if (!released.has(id) && id !== 'exclusive') resolve()
  await Promise.all([manager.wait('run-a'), manager.wait('run-b')])
  assert.equal(maxActive, 3)
})

function item(id, exclusive = false) {
  return { id, title: id, group: 'create', mode: 'default', exclusive }
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('condition not reached')
}

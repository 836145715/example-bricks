const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')

const { catalog } = require('./catalog.cjs')
const { createScenarioExecutor, scenarioHandlers } = require('./scenarios.cjs')

test('每个目录场景都有显式实现', () => {
  assert.deepEqual(
    catalog.filter((scenario) => typeof scenarioHandlers[scenario.id] !== 'function').map((item) => item.id),
    []
  )
})

test('create-text 使用公开 create API 并校验正文与元数据', async () => {
  const calls = []
  const handle = fakeHandle(Buffer.from('resource lab'), 'text/plain; charset=utf-8')
  const execute = createScenarioExecutor(fakePorts({
    resources: {
      create: async (content, options) => (calls.push([content, options]), handle)
    }
  }))
  const result = await execute(catalog.find((item) => item.id === 'create-text'), {
    signal: new AbortController().signal,
    runId: 'run-create'
  })
  assert.equal(calls.length, 1)
  assert.equal(result.sizeBytes, 12)
  assert.equal(result.sha256, createHash('sha256').update('resource lab').digest('hex'))
  assert.equal(result.transfer?.sent?.utf8, 'resource lab')
  assert.equal(result.transfer?.received?.utf8, 'resource lab')
  assert.ok(Array.isArray(result.transfer?.transport?.firstChunkSizes))
})

test('invoke-python 将 ResourceHandle 传给目标并校验报告', async () => {
  const handle = fakeHandle(Buffer.from('hello resource'))
  const execute = createScenarioExecutor(fakePorts({
    resources: { create: async () => handle },
    invokeRoot: async (alias, commandId, input) => {
      assert.equal(alias, 'python_echo')
      assert.equal(commandId, 'inspect')
      assert.equal(input.resource, handle)
      return {
        runtime: 'python', sizeBytes: 14,
        sha256: createHash('sha256').update('hello resource').digest('hex')
      }
    }
  }))
  const result = await execute(catalog.find((item) => item.id === 'invoke-python'), {
    signal: new AbortController().signal,
    runId: 'run-python'
  })
  assert.equal(result.target, 'python')
  assert.equal(result.sizeBytes, 14)
})

test('Writer finish 后接受 SDK 的 RESOURCE_UPLOAD_CLOSED 状态码', async () => {
  const handle = fakeHandle(Buffer.from('done'))
  let finished = false
  const writer = {
    async write() {
      if (finished) throw codedError('RESOURCE_UPLOAD_CLOSED')
    },
    async finish() { finished = true; return handle },
    async abort() {}
  }
  const execute = createScenarioExecutor(fakePorts({
    resources: { createWriter: async () => writer }
  }))
  const result = await execute(catalog.find((item) => item.id === 'writer-finish-state'), {
    signal: new AbortController().signal,
    runId: 'run-writer-finish'
  })
  assert.equal(result.lateWriteRejected, true)
})

test('Writer abort 后接受 SDK 的 RESOURCE_UPLOAD_CLOSED 状态码', async () => {
  let aborted = false
  const writer = {
    async write() {
      if (aborted) throw codedError('RESOURCE_UPLOAD_CLOSED')
    },
    async abort() { aborted = true }
  }
  const execute = createScenarioExecutor(fakePorts({
    resources: { createWriter: async () => writer }
  }))
  const result = await execute(catalog.find((item) => item.id === 'writer-abort-state'), {
    signal: new AbortController().signal,
    runId: 'run-writer-abort'
  })
  assert.equal(result.lateWriteRejected, true)
})

test('取消上传后 finish 接受 SDK 的 RESOURCE_UPLOAD_CLOSED 状态码', async () => {
  let aborted = false
  const writer = {
    async write() {},
    async abort() { aborted = true },
    async finish() { if (aborted) throw codedError('RESOURCE_UPLOAD_CLOSED'); return fakeHandle(Buffer.alloc(0)) }
  }
  const execute = createScenarioExecutor(fakePorts({ resources: { createWriter: async () => writer } }))
  const result = await execute(catalog.find((item) => item.id === 'cancel-upload'), {
    signal: new AbortController().signal,
    runId: 'run-cancel-upload'
  })
  assert.equal(result.finishRejected, true)
})

test('TTL 场景按 Host 返回的 expiresAt 等待而不是假定 1 秒', async () => {
  let now = 10_000
  let slept = 0
  const handle = fakeHandle(Buffer.from('expires'))
  handle.ref.expiresAt = now + 60
  handle.text = async () => {
    if (now < handle.ref.expiresAt) return 'expires'
    throw codedError('RESOURCE_EXPIRED')
  }
  const execute = createScenarioExecutor(fakePorts({
    resources: { create: async () => handle },
    now: () => now,
    sleep: async (ms) => { slept += ms; now += ms }
  }))
  const result = await execute(catalog.find((item) => item.id === 'resource-ttl'), {
    signal: new AbortController().signal,
    runId: 'run-ttl'
  })
  assert.equal(result.ttlExpired, true)
  assert.ok(slept >= 60 && slept < 500)
})

test('伪造 resourceId 接受资源层 RESOURCE_ACCESS_DENIED 错误码', async () => {
  const execute = createScenarioExecutor(fakePorts({
    resources: { create: async () => fakeHandle(Buffer.from('capability')) },
    openForged: async () => { throw codedError('RESOURCE_ACCESS_DENIED') }
  }))
  const result = await execute(catalog.find((item) => item.id === 'forged-token'), {
    signal: new AbortController().signal,
    runId: 'run-forged'
  })
  assert.equal(result.forgedTokenRejected, true)
})

test('场景取消时等待下游调用完成后再收敛', async () => {
  const abort = new AbortController()
  let finish
  let settled = false
  const execute = createScenarioExecutor(fakePorts({
    resources: { create: async () => fakeHandle(Buffer.from('hello resource')) },
    invokeRoot: async () => new Promise((resolve) => { finish = resolve })
  }))
  const running = execute(catalog.find((item) => item.id === 'invoke-node'), {
    signal: abort.signal,
    runId: 'run-abort-downstream'
  }).finally(() => { settled = true })
  abort.abort()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  finish({
    runtime: 'node', sizeBytes: 14, chunkCount: 1,
    sha256: createHash('sha256').update('hello resource').digest('hex')
  })
  await running
  assert.equal(settled, true)
})

test('磁盘不足时跳过 1 GiB 场景且不创建 Writer', async () => {
  let created = false
  const execute = createScenarioExecutor(fakePorts({
    freeDiskBytes: async () => 2 * 1024 * 1024 * 1024 - 1,
    resources: { createFrom: async () => { created = true } }
  }))
  await assert.rejects(
    execute(catalog.find((item) => item.id === 'stream-1g'), {
      signal: new AbortController().signal,
      runId: 'run-low-disk'
    }),
    { code: 'SKIPPED' }
  )
  assert.equal(created, false)
})

test('事件场景必须匹配本次 probeId 而不是接受历史残留', async () => {
  let probeId
  let calls = 0
  const execute = createScenarioExecutor(fakePorts({
    publish: async (_event, payload) => { probeId = payload.probeId; return { delivered: 3 } },
    invokeRoot: async (_brickId, _commandId) => {
      calls++
      return { runtime: 'node', received: true, probeId: calls <= 3 ? 'stale-probe' : probeId }
    },
    sleep: async () => undefined
  }))
  const result = await execute(catalog.find((item) => item.id === 'event-resource-handle'), {
    signal: new AbortController().signal,
    runId: 'run-event-probe'
  })
  assert.equal(result.delivered, 3)
  assert.ok(calls > 3)
})

test('transform-cross-language 用 invoke 拿 ResourceRef 再 resources.open', async () => {
  const content = Buffer.from('Transform Resource Lab')
  const opened = []
  const invoked = []
  let current = fakeHandle(content)
  const execute = createScenarioExecutor(fakePorts({
    resources: {
      create: async () => current,
      open: (ref) => {
        opened.push(ref)
        assert.equal(ref.kind, 'brickly.resource')
        return current
      }
    },
    invokeRoot: async (alias, commandId, input) => {
      invoked.push([alias, commandId])
      assert.equal(commandId, 'transform')
      assert.equal(input.mask, 0x20)
      const next = xorBuffer(await collectHandleBytes(input.resource))
      current = fakeHandle(next)
      return current.ref
    }
  }))
  const result = await execute(catalog.find((item) => item.id === 'transform-cross-language'), {
    signal: new AbortController().signal,
    runId: 'run-transform'
  })
  assert.deepEqual(invoked, [
    ['node_echo', 'transform'],
    ['python_echo', 'transform'],
    ['go_echo', 'transform']
  ])
  assert.equal(opened.length, 3)
  assert.deepEqual(result.hops, ['node', 'python', 'go'])
  assert.equal(result.sizeBytes, content.byteLength)
  assert.equal(result.sha256, createHash('sha256').update(xorBuffer(xorBuffer(xorBuffer(content)))).digest('hex'))
})

test('默认 64 MiB 场景经过 Node Python Go 三语言读取', async () => {
  const sizeBytes = 64 * 1024 * 1024
  const digest = createHash('sha256').update(Buffer.alloc(sizeBytes, 0x61)).digest('hex')
  const targets = []
  const handle = fakeHandle(Buffer.alloc(sizeBytes, 0x61))
  const execute = createScenarioExecutor(fakePorts({
    resources: { createFrom: async () => handle },
    invokeRoot: async (alias) => {
      targets.push(alias)
      return { runtime: alias.replace('_echo', ''), sizeBytes, sha256: digest, chunkCount: 1024 }
    }
  }))
  const result = await execute(catalog.find((item) => item.id === 'default-64m-stream'), {
    signal: new AbortController().signal,
    runId: 'run-64m'
  })
  assert.deepEqual(result.hops, ['resource-lab', 'node', 'python', 'go'])
  assert.equal(targets.length, 3)
})

test('慢速 child 收到 run 取消后通过独立命令实际中止', async () => {
  const abort = new AbortController()
  let rejectHold
  let cancelledOperationId
  const handle = fakeHandle(Buffer.alloc(8 * 1024 * 1024, 0x61))
  const execute = createScenarioExecutor(fakePorts({
    resources: { createFrom: async () => handle },
    invokeRoot: async () => new Promise((_resolve, reject) => { rejectHold = reject }),
    invokeDetached: async (_alias, commandId, input) => {
      assert.equal(commandId, 'cancel-hold')
      cancelledOperationId = input.operationId
      rejectHold(codedError('CANCELLED'))
      return { cancelled: true }
    }
  }))
  const running = execute(catalog.find((item) => item.id === 'cancel-child-invoke'), {
    signal: abort.signal,
    runId: 'run-cancel-child'
  })
  await new Promise((resolve) => setImmediate(resolve))
  abort.abort()
  const result = await running
  assert.equal(typeof cancelledOperationId, 'string')
  assert.equal(result.childCancelled, true)
  assert.equal(result.childCleanupCompleted, true)
})

function fakePorts(overrides = {}) {
  return {
    resources: {
      create: async () => fakeHandle(Buffer.alloc(0)),
      open: (ref) => fakeHandle(Buffer.from('{}'), ref?.mimeType ?? 'application/json')
    },
    invokeRoot: async () => ({}),
    publish: async () => ({ delivered: 1 }),
    tempDir: process.cwd(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides
  }
}

function fakeHandle(content, mimeType = 'application/octet-stream') {
  return {
    ref: {
      kind: 'brickly.resource', resourceId: 'res_test',
      sizeBytes: content.byteLength, mimeType,
      sha256: createHash('sha256').update(content).digest('hex')
    },
    async text() { return content.toString('utf8') },
    async json() { return JSON.parse(content.toString('utf8')) },
    async bytes() { return content },
    async *stream() { yield content },
    async saveTo() {},
    async close() {},
    async revoke() { this.revoked = true }
  }
}

async function collectHandleBytes(handle) {
  if (typeof handle?.bytes === 'function') return Buffer.from(await handle.bytes())
  const chunks = []
  for await (const chunk of handle.stream()) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function xorBuffer(value, mask = 0x20) {
  return Buffer.from(value.map((byte) => byte ^ mask))
}

function codedError(code) {
  return Object.assign(new Error(code), { code })
}

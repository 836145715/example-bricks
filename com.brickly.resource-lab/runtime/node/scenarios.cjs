'use strict'

const { createHash } = require('node:crypto')
const { readFile, rm, stat } = require('node:fs/promises')
const { join } = require('node:path')
const { SkipScenario, WaitingRestart } = require('./run-manager.cjs')
const { sanitizeResourceRef } = require('./contracts.cjs')

const KiB = 1024
const MiB = 1024 * KiB
const TARGETS = Object.freeze({
  node: 'com.brickly.resource-echo-node',
  python: 'com.brickly.resource-echo-python',
  go: 'com.brickly.resource-echo-go'
})

function createScenarioExecutor(ports) {
  return async (scenario, context) => {
    const handler = scenarioHandlers[scenario.id]
    if (!handler) throw new SkipScenario(`场景尚未实现：${scenario.id}`)
    return handler(ports, scenario, context)
  }
}

const scenarioHandlers = {
  'create-empty': (ports) => createAndInspect(ports, Buffer.alloc(0)),
  'create-text': (ports) => createAndInspect(ports, 'resource lab', { mimeType: 'text/plain; charset=utf-8' }),
  'create-binary': (ports) => createAndInspect(ports, Buffer.alloc(1 * KiB, 0x61)),
  'create-unicode-boundary': createUnicodeBoundary,
  'create-from-stream': (ports, scenario) => createFromAndInspect(ports, scenario.sizeBytes),
  'writer-arbitrary-chunks': writerArbitraryChunks,
  'writer-finish-state': writerFinishState,
  'writer-abort-state': writerAbortState,
  'read-text': readText,
  'read-json': readJson,
  'read-stream': (ports, scenario) => createFromAndInspect(ports, scenario.sizeBytes),
  'read-save-to': readSaveTo,
  'read-early-close': readEarlyClose,
  'read-concurrent-rejected': readConcurrentRejected,
  'invoke-node': invokeTarget,
  'invoke-python': invokeTarget,
  'invoke-go': invokeTarget,
  'relay-node-python-go': relayAcrossLanguages,
  'transform-cross-language': transformAcrossLanguages,
  'event-resource-handle': eventResourceHandle,
  'resource-revoke': resourceRevoke,
  'resource-ttl': resourceTtl,
  'forged-token': forgedToken,
  'immutable-snapshot': immutableSnapshot,
  'cancel-upload': cancelUpload,
  'restart-orphan-cleanup': restartOrphanCleanup,
  'default-64m-stream': (ports, scenario, context) => createFromAndInspect(ports, scenario.sizeBytes, context.signal),
  'materialize-201m-rejected': materializeTooLarge,
  'stream-201m': (ports, scenario, context) => createFromAndInspect(ports, scenario.sizeBytes, context.signal),
  'stream-1g': (ports, scenario, context) => createFromAndInspect(ports, scenario.sizeBytes, context.signal),
  'slow-reader-decoupled': slowReaderDecoupled
}

async function createAndInspect(ports, content, options = {}) {
  const expected = toBuffer(content)
  const handle = await ports.resources.create(content, options)
  try {
    const actual = await inspect(handle)
    assertDigest(actual, expected)
    return { ...actual, resource: sanitizeResourceRef(handle.ref) }
  } finally {
    await cleanupHandle(handle)
  }
}

async function createUnicodeBoundary(ports) {
  const text = `${'测'.repeat(349_525)}🙂tail`
  return createAndInspect(ports, text, { mimeType: 'text/plain; charset=utf-8' })
}

async function createFromAndInspect(ports, sizeBytes, signal) {
  requirePort(ports.resources.createFrom, 'resources.createFrom')
  const handle = await ports.resources.createFrom(patternSource(sizeBytes, signal), {
    expectedSizeBytes: sizeBytes,
    mimeType: 'application/octet-stream',
    name: `resource-lab-${sizeBytes}.bin`
  })
  try {
    const actual = await inspect(handle, signal)
    const expectedSha256 = hashPattern(sizeBytes)
    if (actual.sizeBytes !== sizeBytes || actual.sha256 !== expectedSha256) throw mismatch()
    return { ...actual, resource: sanitizeResourceRef(handle.ref) }
  } finally {
    await cleanupHandle(handle)
  }
}

async function writerArbitraryChunks(ports) {
  requirePort(ports.resources.createWriter, 'resources.createWriter')
  const chunks = [Buffer.alloc(13, 0x61), Buffer.alloc(2 * MiB + 7, 0x62), '结束🙂']
  const expected = Buffer.concat(chunks.map(toBuffer))
  const writer = await ports.resources.createWriter({ expectedSizeBytes: expected.byteLength, name: 'arbitrary.bin' })
  let handle
  try {
    for (const chunk of chunks) await writer.write(chunk)
    handle = await writer.finish()
    const actual = await inspect(handle)
    assertDigest(actual, expected)
    return actual
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  } finally {
    await cleanupHandle(handle)
  }
}

async function writerFinishState(ports) {
  requirePort(ports.resources.createWriter, 'resources.createWriter')
  const writer = await ports.resources.createWriter()
  await writer.write('done')
  const handle = await writer.finish()
  try {
    const repeated = await writer.finish()
    if (repeated.ref.resourceId !== handle.ref.resourceId) throw mismatch()
    await expectCode(() => writer.write('late'), ['RESOURCE_LIMIT_EXCEEDED', 'INVALID_INPUT'])
    return { sizeBytes: handle.ref.sizeBytes, repeatedFinish: true, lateWriteRejected: true }
  } finally { await cleanupHandle(handle) }
}

async function writerAbortState(ports) {
  requirePort(ports.resources.createWriter, 'resources.createWriter')
  const writer = await ports.resources.createWriter()
  await writer.write(Buffer.alloc(128 * KiB, 0x61))
  await writer.abort()
  await expectCode(() => writer.write('late'), ['RESOURCE_LIMIT_EXCEEDED', 'INVALID_INPUT'])
  return { aborted: true, lateWriteRejected: true }
}

async function readText(ports) {
  const text = 'Resource Lab 文本读取🙂'
  const handle = await ports.resources.create(text)
  try {
    if (await handle.text() !== text) throw mismatch()
    return { sizeBytes: Buffer.byteLength(text), textMatched: true }
  } finally { await cleanupHandle(handle) }
}

async function readJson(ports) {
  const value = { name: 'Resource Lab', count: 3, unicode: '资源' }
  const json = JSON.stringify(value)
  const handle = await ports.resources.create(json, { mimeType: 'application/json' })
  try {
    if (JSON.stringify(await handle.json()) !== json) throw mismatch()
    return { sizeBytes: Buffer.byteLength(json), jsonMatched: true }
  } finally { await cleanupHandle(handle) }
}

async function readSaveTo(ports, scenario, context) {
  const handle = await ports.resources.createFrom(patternSource(scenario.sizeBytes, context.signal), { expectedSizeBytes: scenario.sizeBytes })
  const path = join(ports.tempDir, `resource-lab-${context.runId}-${Date.now()}.bin`)
  try {
    await handle.saveTo(path)
    const info = await stat(path)
    const bytes = await readFile(path)
    if (info.size !== scenario.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== hashPattern(scenario.sizeBytes)) throw mismatch()
    return { sizeBytes: info.size, saved: true }
  } finally {
    await rm(path, { force: true }).catch(() => undefined)
    await cleanupHandle(handle)
  }
}

async function readEarlyClose(ports) {
  const handle = await ports.resources.createFrom(patternSource(2 * MiB), { expectedSizeBytes: 2 * MiB })
  try {
    for await (const _chunk of handle.stream()) break
    const actual = await inspect(handle)
    if (actual.sizeBytes !== 2 * MiB) throw mismatch()
    return { sizeBytes: actual.sizeBytes, reopened: true }
  } finally { await cleanupHandle(handle) }
}

async function readConcurrentRejected(ports) {
  const handle = await ports.resources.createFrom(patternSource(2 * MiB), { expectedSizeBytes: 2 * MiB })
  try {
    const first = handle.stream()[Symbol.asyncIterator]()
    const second = handle.stream()[Symbol.asyncIterator]()
    await first.next()
    await expectCode(() => second.next(), ['RESOURCE_LIMIT_EXCEEDED'])
    await first.return?.()
    await second.return?.()
    return { sizeBytes: handle.ref.sizeBytes, concurrentReadRejected: true }
  } finally { await cleanupHandle(handle) }
}

async function invokeTarget(ports, scenario) {
  const target = scenario.target
  const brickId = TARGETS[target]
  const content = Buffer.from('hello resource')
  const handle = await ports.resources.create(content)
  try {
    const report = await ports.invokeRoot(brickId, 'inspect', { resource: handle })
    assertReport(report, content, target)
    return { target, sizeBytes: report.sizeBytes, sha256: report.sha256, chunkCount: report.chunkCount }
  } finally { await cleanupHandle(handle) }
}

async function relayAcrossLanguages(ports) {
  const content = Buffer.alloc(8 * MiB, 0x61)
  const handle = await ports.resources.create(content)
  try {
    const report = await ports.invokeRoot(TARGETS.node, 'relay', {
      resource: handle,
      targetBrickId: TARGETS.python,
      targetCommandId: 'relay',
      targetInput: { targetBrickId: TARGETS.go, targetCommandId: 'inspect' }
    })
    assertReport(report, content, 'go')
    return { sizeBytes: content.byteLength, sha256: report.sha256, hops: ['node', 'python', 'go'] }
  } finally { await cleanupHandle(handle) }
}

async function transformAcrossLanguages(ports) {
  const content = Buffer.from('Transform Resource Lab')
  let handle = await ports.resources.create(content)
  try {
    for (const target of ['node', 'python', 'go']) {
      const next = await ports.invokeRootResource(TARGETS[target], 'transform', { resource: handle, mask: 0x20 })
      await cleanupHandle(handle)
      handle = next
    }
    const actual = await inspect(handle)
    const expected = xorBuffer(xorBuffer(xorBuffer(content)))
    assertDigest(actual, expected)
    return { ...actual, hops: ['node', 'python', 'go'] }
  } finally { await cleanupHandle(handle) }
}

async function eventResourceHandle(ports) {
  await ports.publish('resource-lab:probe', { probeId: `probe-${Date.now()}`, message: 'resource event' })
  const reports = []
  for (const target of ['node', 'python', 'go']) {
    let report
    for (let attempt = 0; attempt < 20; attempt++) {
      report = await ports.invokeRoot(TARGETS[target], 'event-last', {})
      if (report?.received) break
      await ports.sleep(50)
    }
    if (!report?.received) throw new SkipScenario(`${target} 未收到资源事件`)
    reports.push(report)
  }
  return { delivered: reports.length, targets: reports.map((item) => item.runtime) }
}

async function resourceRevoke(ports) {
  const handle = await ports.resources.create('revoke me')
  await handle.revoke()
  await expectCode(() => handle.text(), ['RESOURCE_EXPIRED'])
  return { sizeBytes: handle.ref.sizeBytes, revoked: true }
}

async function resourceTtl(ports) {
  const handle = await ports.resources.create('expires', { ttlMs: 1000 })
  try {
    await ports.sleep(1100)
    await expectCode(() => handle.text(), ['RESOURCE_EXPIRED'])
    return { sizeBytes: handle.ref.sizeBytes, ttlExpired: true }
  } finally { await cleanupHandle(handle) }
}

async function forgedToken(ports) {
  if (typeof ports.openForged !== 'function') throw new SkipScenario('当前 SDK 端口不支持伪造句柄验收')
  const handle = await ports.resources.create('capability')
  try {
    await expectCode(() => ports.openForged({ ...handle.ref, accessToken: 'forged-token' }), ['PERMISSION_DENIED', 'RESOURCE_EXPIRED'])
    return { sizeBytes: handle.ref.sizeBytes, forgedTokenRejected: true }
  } finally { await cleanupHandle(handle) }
}

async function immutableSnapshot(ports) {
  const content = Buffer.from('snapshot')
  const expected = Buffer.from(content)
  const handle = await ports.resources.create(content)
  content.fill(0)
  try {
    const actual = await inspect(handle)
    assertDigest(actual, expected)
    return { ...actual, immutable: true }
  } finally { await cleanupHandle(handle) }
}

async function cancelUpload(ports) {
  const writer = await ports.resources.createWriter({ name: 'cancelled.part' })
  await writer.write(Buffer.alloc(2 * MiB, 0x61))
  await writer.abort()
  await expectCode(() => writer.finish(), ['RESOURCE_LIMIT_EXCEEDED', 'INVALID_INPUT'])
  return { aborted: true, finishRejected: true }
}

async function restartOrphanCleanup(ports, _scenario, context) {
  if (typeof ports.prepareRestart !== 'function') throw new SkipScenario('当前 Host 未提供公开重启检查点能力')
  const checkpoint = await ports.prepareRestart(context.runId)
  throw new WaitingRestart(checkpoint)
}

async function materializeTooLarge(ports, scenario, context) {
  const handle = await ports.resources.createFrom(patternSource(scenario.sizeBytes, context.signal), { expectedSizeBytes: scenario.sizeBytes })
  try {
    await expectCode(() => handle.text(), ['RESOURCE_MATERIALIZATION_TOO_LARGE'])
    return { sizeBytes: scenario.sizeBytes, materializationRejected: true, sha256: handle.ref.sha256 }
  } finally { await cleanupHandle(handle) }
}

async function slowReaderDecoupled(ports, scenario, context) {
  const startedAt = ports.now()
  const handle = await ports.resources.createFrom(patternSource(scenario.sizeBytes, context.signal), { expectedSizeBytes: scenario.sizeBytes })
  const finishedAt = ports.now()
  try {
    const report = await ports.invokeRoot(TARGETS.node, 'hold', { resource: handle, delayMs: 2 })
    if (report.sizeBytes !== scenario.sizeBytes) throw mismatch()
    return { sizeBytes: report.sizeBytes, sha256: report.sha256, uploadDurationMs: finishedAt - startedAt, slowReadCompleted: true }
  } finally { await cleanupHandle(handle) }
}

async function inspect(handle, signal) {
  const digest = createHash('sha256')
  let sizeBytes = 0
  let chunkCount = 0
  for await (const chunk of handle.stream()) {
    if (signal?.aborted) throw cancelled()
    digest.update(chunk)
    sizeBytes += chunk.byteLength
    chunkCount++
  }
  return { sizeBytes, chunkCount, sha256: digest.digest('hex'), mimeType: handle.ref?.mimeType }
}

async function* patternSource(sizeBytes, signal, byte = 0x61) {
  const chunk = Buffer.alloc(64 * KiB, byte)
  let remaining = sizeBytes
  while (remaining > 0) {
    if (signal?.aborted) throw cancelled()
    const length = Math.min(remaining, chunk.byteLength)
    yield chunk.subarray(0, length)
    remaining -= length
  }
}

function hashPattern(sizeBytes, byte = 0x61) {
  const digest = createHash('sha256')
  const chunk = Buffer.alloc(64 * KiB, byte)
  let remaining = sizeBytes
  while (remaining > 0) { const length = Math.min(remaining, chunk.length); digest.update(chunk.subarray(0, length)); remaining -= length }
  return digest.digest('hex')
}

async function cleanupHandle(handle) {
  if (!handle) return
  await handle.close?.().catch(() => undefined)
  await handle.revoke?.().catch(() => undefined)
}

function assertReport(report, content, runtime) {
  if (report?.runtime !== runtime || report.sizeBytes !== content.byteLength || report.sha256 !== createHash('sha256').update(content).digest('hex')) throw mismatch()
}
function assertDigest(actual, expected) { if (actual.sizeBytes !== expected.byteLength || actual.sha256 !== createHash('sha256').update(expected).digest('hex')) throw mismatch() }
async function expectCode(operation, codes) { try { await operation() } catch (error) { if (codes.includes(error?.code)) return; throw error } throw mismatch('预期操作失败，但实际成功') }
function requirePort(port, name) { if (typeof port !== 'function') throw new SkipScenario(`当前 SDK 缺少 ${name}`) }
function toBuffer(value) { return Buffer.isBuffer(value) ? value : Buffer.from(value) }
function xorBuffer(value, mask = 0x20) { return Buffer.from(value.map((byte) => byte ^ mask)) }
function mismatch(message = '资源校验结果不一致') { const error = new Error(message); error.code = 'ASSERTION_FAILED'; return error }
function cancelled() { const error = new Error('cancelled'); error.code = 'CANCELLED'; return error }

module.exports = { TARGETS, createScenarioExecutor, scenarioHandlers }

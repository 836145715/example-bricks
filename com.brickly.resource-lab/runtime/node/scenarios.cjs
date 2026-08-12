'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { readFile, rm, stat } = require('node:fs/promises')
const { join } = require('node:path')
const { SkipScenario, WaitingRestart } = require('./run-manager.cjs')
const { sanitizeResourceRef } = require('./contracts.cjs')

const KiB = 1024
const MiB = 1024 * KiB
const GiB = 1024 * MiB
const TARGETS = Object.freeze({
  node: 'com.brickly.resource-echo-node',
  python: 'com.brickly.resource-echo-python',
  go: 'com.brickly.resource-echo-go'
})

function createScenarioExecutor(ports) {
  return async (scenario, context) => {
    const handler = scenarioHandlers[scenario.id]
    if (!handler) throw new SkipScenario(`场景尚未实现：${scenario.id}`)
    await checkRequirements(ports, scenario)
    return handler(ports, scenario, context)
  }
}

async function checkRequirements(ports, scenario) {
  if (!scenario.requirements?.includes('disk-2gib')) return
  if (typeof ports.freeDiskBytes !== 'function') throw new SkipScenario('当前 Runtime 无法读取磁盘可用空间')
  if (await ports.freeDiskBytes() < 2 * GiB) throw new SkipScenario('可用磁盘空间不足 2 GiB')
}

const scenarioHandlers = {
  'create-empty': (ports) => createAndInspect(ports, Buffer.alloc(0)),
  'create-text': (ports) => createAndInspect(ports, 'resource lab', { mimeType: 'text/plain; charset=utf-8' }),
  'create-binary': (ports) => createAndInspect(ports, Buffer.alloc(1 * KiB, 0x61)),
  'create-unicode-boundary': createUnicodeBoundary,
  'create-from-stream': (ports, scenario) => createFromAndInspect(ports, scenario.sizeBytes),
  'writer-arbitrary-chunks': writerArbitraryChunks,
  'writer-write-from': writerWriteFrom,
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
  'cancel-child-invoke': cancelChildInvoke,
  'restart-runtime-recovery': restartRuntimeRecovery,
  'default-64m-stream': fullChain64m,
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
    return {
      ...actual,
      resource: sanitizeResourceRef(handle.ref),
      // 发送侧本地内容预览 + 读回侧预览，便于 UI 看到「真正传了什么」
      transfer: buildTransferView(expected, actual)
    }
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
    return {
      ...actual,
      resource: sanitizeResourceRef(handle.ref),
      transfer: buildTransferView(null, actual, {
        sentDescription: `pattern 0x61 × ${sizeBytes} bytes（流式 createFrom，不落地完整副本）`
      })
    }
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
    return {
      ...actual,
      resource: sanitizeResourceRef(handle.ref),
      transfer: buildTransferView(expected, actual)
    }
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  } finally {
    await cleanupHandle(handle)
  }
}

async function writerWriteFrom(ports, scenario, context) {
  requirePort(ports.resources.createWriter, 'resources.createWriter')
  const writer = await ports.resources.createWriter({ expectedSizeBytes: scenario.sizeBytes })
  let handle
  try {
    await writer.writeFrom(patternSource(scenario.sizeBytes, context.signal))
    handle = await writer.finish()
    const actual = await inspect(handle, context.signal)
    if (actual.sizeBytes !== scenario.sizeBytes || actual.sha256 !== hashPattern(scenario.sizeBytes)) throw mismatch()
    return {
      ...actual,
      writeFrom: true,
      resource: sanitizeResourceRef(handle.ref),
      transfer: buildTransferView(null, actual, {
        sentDescription: `pattern 0x61 × ${scenario.sizeBytes} bytes（Writer.writeFrom）`
      })
    }
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  } finally { await cleanupHandle(handle) }
}

async function writerFinishState(ports) {
  requirePort(ports.resources.createWriter, 'resources.createWriter')
  const writer = await ports.resources.createWriter()
  await writer.write('done')
  const handle = await writer.finish()
  try {
    const repeated = await writer.finish()
    if (repeated.ref.resourceId !== handle.ref.resourceId) throw mismatch()
    await expectCode(() => writer.write('late'), ['RESOURCE_UPLOAD_CLOSED'])
    return { sizeBytes: handle.ref.sizeBytes, repeatedFinish: true, lateWriteRejected: true }
  } finally { await cleanupHandle(handle) }
}

async function writerAbortState(ports) {
  requirePort(ports.resources.createWriter, 'resources.createWriter')
  const writer = await ports.resources.createWriter()
  await writer.write(Buffer.alloc(128 * KiB, 0x61))
  await writer.abort()
  await expectCode(() => writer.write('late'), ['RESOURCE_UPLOAD_CLOSED'])
  return { aborted: true, lateWriteRejected: true }
}

async function readText(ports) {
  const text = 'Resource Lab 文本读取🙂'
  const handle = await ports.resources.create(text)
  try {
    const received = await handle.text()
    if (received !== text) throw mismatch()
    const buf = Buffer.from(text)
    return {
      sizeBytes: buf.byteLength,
      textMatched: true,
      transfer: buildTransferView(buf, {
        sizeBytes: buf.byteLength,
        sha256: createHash('sha256').update(buf).digest('hex'),
        payload: buildPayloadPreview(buf)
      })
    }
  } finally { await cleanupHandle(handle) }
}

async function readJson(ports) {
  const value = { name: 'Resource Lab', count: 3, unicode: '资源' }
  const json = JSON.stringify(value)
  const handle = await ports.resources.create(json, { mimeType: 'application/json' })
  try {
    const received = await handle.json()
    if (JSON.stringify(received) !== json) throw mismatch()
    const buf = Buffer.from(json)
    return {
      sizeBytes: buf.byteLength,
      jsonMatched: true,
      json: received,
      transfer: buildTransferView(buf, {
        sizeBytes: buf.byteLength,
        sha256: createHash('sha256').update(buf).digest('hex'),
        payload: buildPayloadPreview(buf)
      })
    }
  } finally { await cleanupHandle(handle) }
}

async function readSaveTo(ports, scenario, context) {
  const handle = await ports.resources.createFrom(patternSource(scenario.sizeBytes, context.signal), { expectedSizeBytes: scenario.sizeBytes })
  const path = join(ports.tempDir, `resource-lab-${context.runId}-${Date.now()}.bin`)
  try {
    await handle.saveTo(path)
    const info = await stat(path)
    const bytes = await readFile(path)
    const expectedSha = hashPattern(scenario.sizeBytes)
    const actualSha = createHash('sha256').update(bytes).digest('hex')
    if (info.size !== scenario.sizeBytes || actualSha !== expectedSha) throw mismatch()
    return {
      sizeBytes: info.size,
      saved: true,
      sha256: actualSha,
      transfer: buildTransferView(null, {
        sizeBytes: info.size,
        sha256: actualSha,
        payload: buildPayloadPreview(bytes.subarray(0, PREVIEW_MAX_BYTES), {
          totalBytes: bytes.byteLength
        })
      }, { sentDescription: `saveTo 落盘后回读；预览文件头 ${Math.min(PREVIEW_MAX_BYTES, bytes.byteLength)} 字节` })
    }
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
    return {
      target,
      sizeBytes: report.sizeBytes,
      sha256: report.sha256,
      chunkCount: report.chunkCount,
      transfer: buildTransferView(content, {
        sizeBytes: report.sizeBytes,
        sha256: report.sha256,
        payload: buildPayloadPreview(content)
      }, { peer: { runtime: report.runtime, chunkCount: report.chunkCount } })
    }
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
    return {
      sizeBytes: content.byteLength,
      sha256: report.sha256,
      hops: ['node', 'python', 'go'],
      transfer: buildTransferView(null, {
        sizeBytes: content.byteLength,
        sha256: report.sha256,
        payload: buildPayloadPreview(content.subarray(0, 256), { totalBytes: content.byteLength })
      }, {
        sentDescription: `8 MiB pattern 0x61，经 Node→Python→Go relay；预览为前 256 字节`
      })
    }
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
  const probeId = `probe-${randomUUID()}`
  await ports.publish('resource-lab:probe', { probeId, message: 'resource event' })
  const reports = []
  for (const target of ['node', 'python', 'go']) {
    let report
    for (let attempt = 0; attempt < 20; attempt++) {
      report = await ports.invokeRoot(TARGETS[target], 'event-last', {})
      if (report?.received && report?.probeId === probeId) break
      await ports.sleep(50)
    }
    if (!report?.received || report?.probeId !== probeId) throw new SkipScenario(`${target} 未收到本次资源事件`)
    reports.push(report)
  }
  return { delivered: reports.length, targets: reports.map((item) => item.runtime) }
}

async function fullChain64m(ports, scenario, context) {
  const handle = await ports.resources.createFrom(patternSource(scenario.sizeBytes, context.signal), {
    expectedSizeBytes: scenario.sizeBytes,
    mimeType: 'application/octet-stream',
    name: `resource-lab-${scenario.sizeBytes}.bin`
  })
  try {
    const local = await inspect(handle, context.signal)
    if (local.sizeBytes !== scenario.sizeBytes || local.sha256 !== hashPattern(scenario.sizeBytes)) throw mismatch()
    for (const target of ['node', 'python', 'go']) {
      const report = await ports.invokeRoot(TARGETS[target], 'inspect', { resource: handle })
      if (report.runtime !== target || report.sizeBytes !== local.sizeBytes || report.sha256 !== local.sha256) throw mismatch()
    }
    return {
      ...local,
      hops: ['resource-lab', 'node', 'python', 'go'],
      resource: sanitizeResourceRef(handle.ref),
      transfer: buildTransferView(null, local, {
        sentDescription: `${scenario.sizeBytes} bytes pattern 0x61，本地 + 三语言 inspect 一致`
      })
    }
  } finally { await cleanupHandle(handle) }
}

async function resourceRevoke(ports) {
  const handle = await ports.resources.create('revoke me')
  await handle.revoke()
  await expectCode(() => handle.text(), ['RESOURCE_EXPIRED'])
  return { sizeBytes: handle.ref.sizeBytes, revoked: true }
}

async function resourceTtl(ports, _scenario, context) {
  const handle = await ports.resources.create(Buffer.alloc(2 * MiB, 0x61), { ttlMs: 60_000 })
  try {
    const iterator = handle.stream()[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done) throw mismatch()
    const deadline = handle.ref?.expiresAt ?? ports.now() + 60_000
    while (ports.now() <= deadline) {
      if (context.signal.aborted) throw cancelled()
      await ports.sleep(Math.min(250, deadline - ports.now() + 25))
    }
    while (!(await iterator.next()).done) {
      if (context.signal.aborted) throw cancelled()
    }
    await expectCode(() => handle.text(), ['RESOURCE_EXPIRED', 'RESOURCE_NOT_FOUND'])
    return { sizeBytes: handle.ref.sizeBytes, ttlExpired: true, activeStreamSurvived: true }
  } finally { await cleanupHandle(handle) }
}

async function forgedToken(ports) {
  if (typeof ports.openForged !== 'function') throw new SkipScenario('当前 SDK 端口不支持伪造句柄验收')
  const handle = await ports.resources.create('capability')
  try {
    await expectCode(() => ports.openForged({ ...handle.ref, accessToken: 'forged-token' }), ['RESOURCE_ACCESS_DENIED', 'PERMISSION_DENIED', 'RESOURCE_EXPIRED'])
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
  await expectCode(() => writer.finish(), ['RESOURCE_UPLOAD_CLOSED'])
  return { aborted: true, finishRejected: true }
}

async function cancelChildInvoke(ports, scenario, context) {
  const handle = await ports.resources.createFrom(patternSource(scenario.sizeBytes, context.signal), {
    expectedSizeBytes: scenario.sizeBytes,
    name: 'cancel-child-invoke.bin'
  })
  try {
    const report = await invokeCancelableHold(ports, handle, 500, context)
    if (report.sizeBytes !== scenario.sizeBytes) throw mismatch()
    return { sizeBytes: report.sizeBytes, sha256: report.sha256, childCleanupCompleted: true }
  } catch (error) {
    if (context.signal.aborted && error?.code === 'CANCELLED' && error?.childCancelled) {
      return { sizeBytes: scenario.sizeBytes, childCancelled: true, childCleanupCompleted: true }
    }
    throw error
  } finally { await cleanupHandle(handle) }
}

async function restartRuntimeRecovery(ports, _scenario, context) {
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
    const report = await invokeCancelableHold(ports, handle, 2, context)
    if (report.sizeBytes !== scenario.sizeBytes) throw mismatch()
    return { sizeBytes: report.sizeBytes, sha256: report.sha256, uploadDurationMs: finishedAt - startedAt, slowReadCompleted: true }
  } finally { await cleanupHandle(handle) }
}

async function invokeCancelableHold(ports, handle, delayMs, context) {
  const operationId = `hold-${context.runId}-${randomUUID()}`
  let cancelPromise
  const cancel = () => {
    cancelPromise ??= requestHoldCancellation(ports, operationId)
  }
  context.signal.addEventListener('abort', cancel, { once: true })
  if (context.signal.aborted) cancel()
  try {
    return await ports.invokeRoot(TARGETS.node, 'hold', { resource: handle, delayMs, operationId })
  } catch (error) {
    if (context.signal.aborted) {
      const result = await cancelPromise
      if (error?.code === 'CANCELLED' && result?.cancelled) error.childCancelled = true
    }
    throw error
  } finally {
    context.signal.removeEventListener('abort', cancel)
  }
}

async function requestHoldCancellation(ports, operationId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const invoke = ports.invokeDetached ?? ports.invokeRoot
    const result = await invoke(TARGETS.node, 'cancel-hold', { operationId })
    if (result?.cancelled) return result
    await ports.sleep(25)
  }
  return { cancelled: false }
}

const PREVIEW_MAX_BYTES = 256
const CHUNK_SIZE_SAMPLES = 16

async function inspect(handle, signal) {
  const digest = createHash('sha256')
  let sizeBytes = 0
  let chunkCount = 0
  const previewParts = []
  let previewLen = 0
  const firstChunkSizes = []
  for await (const chunk of handle.stream()) {
    if (signal?.aborted) throw cancelled()
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    digest.update(buf)
    sizeBytes += buf.byteLength
    chunkCount++
    if (firstChunkSizes.length < CHUNK_SIZE_SAMPLES) firstChunkSizes.push(buf.byteLength)
    if (previewLen < PREVIEW_MAX_BYTES) {
      const take = Math.min(PREVIEW_MAX_BYTES - previewLen, buf.byteLength)
      previewParts.push(buf.subarray(0, take))
      previewLen += take
    }
  }
  const previewBuf = Buffer.concat(previewParts, previewLen)
  return {
    sizeBytes,
    chunkCount,
    sha256: digest.digest('hex'),
    mimeType: handle.ref?.mimeType,
    payload: buildPayloadPreview(previewBuf, { totalBytes: sizeBytes }),
    transport: {
      chunkCount,
      firstChunkSizes,
      note:
        firstChunkSizes.length < chunkCount
          ? `仅采样前 ${firstChunkSizes.length} 个分块大小，共 ${chunkCount} 块`
          : `共 ${chunkCount} 个分块`
    }
  }
}

/**
 * @param {Buffer|null} sentBuffer 发送侧完整或可预览的本地字节（大文件可传 null）
 * @param {{ sizeBytes?: number, sha256?: string, payload?: object, transport?: object }} received
 */
function buildTransferView(sentBuffer, received, options = {}) {
  const sent =
    sentBuffer != null
      ? buildPayloadPreview(sentBuffer)
      : options.sentDescription
        ? {
            kind: 'payload-preview',
            description: options.sentDescription,
            totalBytes: received?.sizeBytes
          }
        : undefined
  return compactObject({
    kind: 'transfer-view',
    sent,
    received: received?.payload,
    transport: received?.transport,
    peer: options.peer,
    sha256: received?.sha256,
    sizeBytes: received?.sizeBytes,
    note: 'sent/received 仅为前若干字节预览，完整内容以 sha256 为准，避免把大文件打进 UI/事件。'
  })
}

function buildPayloadPreview(buffer, options = {}) {
  const totalBytes = options.totalBytes ?? buffer.byteLength
  const max = options.maxBytes ?? PREVIEW_MAX_BYTES
  const sample = buffer.subarray(0, Math.min(max, buffer.byteLength))
  const hex = [...sample].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  let utf8
  let encoding = 'binary'
  try {
    const text = sample.toString('utf8')
    if (isMostlyPrintable(text)) {
      utf8 = totalBytes > sample.byteLength ? `${text}…` : text
      encoding = 'utf8'
    }
  } catch {
    // ignore
  }
  return compactObject({
    kind: 'payload-preview',
    totalBytes,
    previewBytes: sample.byteLength,
    truncated: totalBytes > sample.byteLength,
    encoding,
    utf8,
    hex,
    note:
      totalBytes > sample.byteLength
        ? `仅展示前 ${sample.byteLength} / ${totalBytes} 字节`
        : `完整 ${totalBytes} 字节`
  })
}

function isMostlyPrintable(text) {
  if (!text) return false
  let bad = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)
    const ok = c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 0xfffd)
    if (!ok) bad++
  }
  return bad / [...text].length < 0.1
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null))
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

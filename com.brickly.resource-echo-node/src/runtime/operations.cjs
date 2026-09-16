'use strict'

const { createHash } = require('node:crypto')

async function inspectResource(resource, runtime = 'node', delayMs = 0, signal) {
  if (!resource || typeof resource.stream !== 'function') throw invalidResource()
  const hash = createHash('sha256')
  let sizeBytes = 0
  let chunkCount = 0
  for await (const chunk of resource.stream()) {
    if (signal?.aborted) throw cancelled()
    hash.update(chunk)
    sizeBytes += chunk.byteLength
    chunkCount++
    if (delayMs > 0) await delay(delayMs, signal)
  }
  return {
    runtime,
    sizeBytes,
    chunkCount,
    sha256: hash.digest('hex'),
    mimeType: resource.ref?.mimeType ?? 'application/octet-stream'
  }
}

async function* createPatternSource(sizeBytes, chunkBytes = 64 * 1024, byte = 0x61) {
  requireSize(sizeBytes)
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw invalidInput('chunkBytes')
  const chunk = Buffer.alloc(Math.min(chunkBytes, Math.max(1, sizeBytes)), byte)
  let remaining = sizeBytes
  while (remaining > 0) {
    const length = Math.min(remaining, chunk.length)
    yield chunk.subarray(0, length)
    remaining -= length
  }
}

async function* transformSource(resource, mask = 0x20) {
  for await (const chunk of resource.stream()) {
    const output = Buffer.allocUnsafe(chunk.byteLength)
    for (let index = 0; index < chunk.byteLength; index++) output[index] = chunk[index] ^ mask
    yield output
  }
}

function requireSize(value) {
  const sizeBytes = Number(value)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw invalidInput('sizeBytes')
  return sizeBytes
}

function invalidResource() {
  return invalidInput('resource')
}

function invalidInput(name) {
  const error = new Error(`${name} is invalid`)
  error.code = 'INVALID_INPUT'
  return error
}

function cancelled() {
  const error = new Error('cancelled')
  error.code = 'CANCELLED'
  return error
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(cancelled())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

module.exports = { createPatternSource, inspectResource, requireSize, transformSource }

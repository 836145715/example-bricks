const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const test = require('node:test')

const { createPatternSource, inspectResource } = require('./operations.cjs')

test('Node inspect 统计分块、字节和 SHA-256', async () => {
  const chunks = [Buffer.from('hello '), Buffer.from('resource')]
  const result = await inspectResource(fakeResource(chunks), 'node')
  assert.deepEqual(result, {
    runtime: 'node',
    sizeBytes: 14,
    chunkCount: 2,
    sha256: createHash('sha256').update('hello resource').digest('hex'),
    mimeType: 'text/plain'
  })
})

test('Node pattern source 按固定种子生成指定大小且不整包分配', async () => {
  const chunks = []
  for await (const chunk of createPatternSource(1024 * 1024 + 17, 64 * 1024, 0x61)) {
    chunks.push(chunk)
  }
  assert.equal(chunks.reduce((total, chunk) => total + chunk.byteLength, 0), 1024 * 1024 + 17)
  assert.equal(chunks.length, 17)
  assert.ok(chunks.every((chunk) => chunk.byteLength <= 64 * 1024))
  assert.equal(chunks[0][0], 0x61)
})

function fakeResource(chunks) {
  return {
    ref: { mimeType: 'text/plain' },
    async *stream() {
      yield* chunks
    }
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeChunkBytes, fromBase64 } from './brickly.ts'

test('decodeChunkBytes reads base64 string bytes', () => {
  const bytes = decodeChunkBytes({ type: 'data', encoding: 'base64', bytes: btoa('hi') })
  assert.ok(bytes instanceof Uint8Array)
  assert.equal(new TextDecoder().decode(bytes), 'hi')
})

test('decodeChunkBytes accepts Uint8Array bytes without encoding', () => {
  const payload = Uint8Array.from([0x1b, 0x5b, 0x6d])
  const bytes = decodeChunkBytes({ type: 'data', bytes: payload })
  assert.deepEqual(bytes, payload)
})

test('decodeChunkBytes accepts Node Buffer JSON shape', () => {
  const bytes = decodeChunkBytes({ encoding: 'base64', bytes: { type: 'Buffer', data: [65, 66] } })
  assert.ok(bytes instanceof Uint8Array)
  assert.deepEqual(Array.from(bytes), [65, 66])
})

test('fromBase64 roundtrips', () => {
  assert.equal(new TextDecoder().decode(fromBase64(btoa('prompt$ '))), 'prompt$ ')
})

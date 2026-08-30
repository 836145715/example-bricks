import assert from 'node:assert/strict'
import test from 'node:test'
import { containsCommandSubmit, isCopyKey, isPasteKey, isUiField } from './terminal-keys.ts'

function key(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    code: '',
    ...init
  } as KeyboardEvent
}

test('copy chords', () => {
  assert.equal(isCopyKey(key({ ctrlKey: true, code: 'KeyC' })), true)
  assert.equal(isCopyKey(key({ ctrlKey: true, code: 'Insert' })), true)
  assert.equal(isCopyKey(key({ ctrlKey: true, code: 'KeyV' })), false)
})

test('paste chords', () => {
  assert.equal(isPasteKey(key({ ctrlKey: true, code: 'KeyV' })), true)
  assert.equal(isPasteKey(key({ shiftKey: true, code: 'Insert' })), true)
  assert.equal(isPasteKey(key({ ctrlKey: true, code: 'KeyC' })), false)
})

test('ui field helper ignores empty targets', () => {
  assert.equal(isUiField(null), false)
})

test('enter and newline count as command submit', () => {
  assert.equal(containsCommandSubmit('ls'), false)
  assert.equal(containsCommandSubmit('ls\r'), true)
  assert.equal(containsCommandSubmit('cd /tmp\n'), true)
})

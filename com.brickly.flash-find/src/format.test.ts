import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatDate, highlightParts, highlightTerms, humanSize } from './format.ts'

test('humanSize', () => {
  assert.equal(humanSize(0), '0 B')
  assert.equal(humanSize(1023), '1023 B')
  assert.equal(humanSize(1024), '1.0 KB')
  assert.equal(humanSize(1536 * 1024), '1.5 MB')
  assert.equal(humanSize(5 * 1024 ** 3), '5.0 GB')
  assert.equal(humanSize(-1), '—')
})

test('formatDate', () => {
  // 2026-09-06 12:34 本地时区
  const ts = new Date(2026, 8, 6, 12, 34).getTime() / 1000
  assert.equal(formatDate(ts), '2026-09-06 12:34')
  assert.equal(formatDate(0), '—')
})

test('highlightTerms 丢弃过滤器并处理引号', () => {
  assert.deepEqual(highlightTerms('hello world'), ['hello', 'world'])
  assert.deepEqual(highlightTerms('report ext:pdf'), ['report'])
  assert.deepEqual(highlightTerms(`path:"my reports" nested`), ['nested'])
  assert.deepEqual(highlightTerms(`size:>10mb "a b" c`), ['a b', 'c'])
})

test('highlightParts 大小写不敏感多词高亮', () => {
  const parts = highlightParts('Hello World.txt', ['hello', 'txt'])
  assert.deepEqual(
    parts.map((p) => [p.text, p.hit]),
    [
      ['Hello', true],
      [' World.', false],
      ['txt', true]
    ]
  )
})

test('highlightParts 无命中返回原文', () => {
  assert.deepEqual(highlightParts('abc', []), [{ text: 'abc', hit: false }])
})

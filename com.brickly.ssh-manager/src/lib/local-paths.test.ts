import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyPaste, looksLikeAbsolutePath, looksLikeLocalFilePath } from './local-paths.ts'

test('ordinary text stays text', () => {
  assert.deepEqual(classifyPaste({ text: 'ls -la' }), { kind: 'text', text: 'ls -la' })
})

test('multiline text is not a path', () => {
  assert.equal(looksLikeAbsolutePath('C:\\a\nC:\\b'), false)
  assert.equal(classifyPaste({ text: 'C:\\a\nC:\\b' }).kind, 'text')
})

test('single windows path is local file intent', () => {
  assert.equal(classifyPaste({ text: 'C:\\Users\\admin\\a.txt' }).kind, 'path')
  assert.equal(looksLikeLocalFilePath('C:\\Users\\admin\\a.txt'), true)
})

test('unix path copied from ssh stays terminal text on windows', () => {
  assert.equal(looksLikeAbsolutePath('/home/alice/a.txt'), true)
  assert.equal(classifyPaste({ text: '/home/alice/a.txt' }).kind, 'text')
})

test('file list wins over text', () => {
  const file = { name: 'a.txt', path: 'D:\\tmp\\a.txt' } as File
  const intent = classifyPaste({ files: [file], text: 'hello' })
  assert.deepEqual(intent, { kind: 'files', paths: ['D:\\tmp\\a.txt'] })
})

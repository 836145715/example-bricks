import assert from 'node:assert/strict'
import test from 'node:test'
import { selectShareDirectory } from '../share-directory'

test('选择目录后返回宿主选择器给出的路径', async () => {
  const selected = await selectShareDirectory('/Users/xuan/Downloads', async (options) => {
    assert.deepEqual(options, { defaultPath: '/Users/xuan/Downloads' })
    return '/Users/xuan/Documents'
  })

  assert.equal(selected, '/Users/xuan/Documents')
})

test('取消目录选择时保持当前路径', async () => {
  const selected = await selectShareDirectory('/Users/xuan/Downloads', async () => undefined)

  assert.equal(selected, '/Users/xuan/Downloads')
})

test('宿主返回空路径时保持当前路径', async () => {
  for (const invalidPath of ['', '   ']) {
    const selected = await selectShareDirectory('/Users/xuan/Downloads', async () => invalidPath)

    assert.equal(selected, '/Users/xuan/Downloads')
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStoppedStatus,
  loadShareSettings,
  saveShareSettings,
  toRuntimeConfig
} from '../share-settings'

class MemoryStorage {
  value: string | null = null

  getItem(): string | null {
    return this.value
  }

  setItem(_key: string, value: string): void {
    this.value = value
  }
}

test('缓存不保存访问码明文', () => {
  const storage = new MemoryStorage()

  saveShareSettings(
    storage,
    {
      root: '/srv/logs',
      port: 9000,
      allowUpload: true,
      accessCode: 'secret'
    },
    true
  )

  assert.equal(storage.value?.includes('secret'), false)
  assert.deepEqual(loadShareSettings(storage), {
    root: '/srv/logs',
    port: 9000,
    allowUpload: true,
    hasAccessCode: true
  })
})

test('损坏缓存回退停止态默认值', () => {
  const storage = new MemoryStorage()
  storage.value = '{broken'

  const settings = loadShareSettings(storage)

  assert.deepEqual(settings, {
    root: '',
    port: 8723,
    allowUpload: false,
    hasAccessCode: false
  })
  assert.deepEqual(createStoppedStatus(settings), {
    running: false,
    root: '',
    port: 8723,
    allowUpload: false,
    hasAccessCode: false,
    startedAt: 0,
    urls: [],
    log: []
  })
})

test('已有访问码且输入为空时保留 runtime 原值', () => {
  assert.deepEqual(
    toRuntimeConfig(
      { root: '/srv', port: 8723, allowUpload: false, accessCode: '   ' },
      true
    ),
    { root: '/srv', port: 8723, allowUpload: false }
  )
})

test('新访问码去除首尾空白后传给 runtime', () => {
  assert.deepEqual(
    toRuntimeConfig(
      { root: '/srv', port: 8723, allowUpload: false, accessCode: ' secret ' },
      false
    ),
    { root: '/srv', port: 8723, allowUpload: false, accessCode: 'secret' }
  )
})

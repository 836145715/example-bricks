/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const test = require('node:test')
const { inferMimeType, parseDataUrl, resolveUploadFile } = require('../src/file-source')

test('parseDataUrl 解析 base64 data URL', () => {
  const parsed = parseDataUrl('data:text/plain;base64,aGVsbG8=', 'file')
  assert.equal(parsed.mimeType, 'text/plain')
  assert.equal(parsed.buffer.toString('utf8'), 'hello')
})

test('resolveUploadFile 支持本地路径输入', async () => {
  const filePath = path.join(os.tmpdir(), `brickly-glm-tools-${Date.now()}.txt`)
  await fs.writeFile(filePath, 'hello')

  try {
    const file = await resolveUploadFile(
      { filePath },
      { fileField: 'file', pathField: 'filePath', label: '测试文件' }
    )
    assert.equal(file.name, path.basename(filePath))
    assert.equal(file.mimeType, 'text/plain')
    assert.equal(file.buffer.toString('utf8'), 'hello')
  } finally {
    await fs.rm(filePath, { force: true })
  }
})

test('resolveUploadFile 支持 file 字段直接传路径字符串', async () => {
  const filePath = path.join(os.tmpdir(), `brickly-glm-tools-file-field-${Date.now()}.txt`)
  await fs.writeFile(filePath, 'from file field')

  try {
    const file = await resolveUploadFile(
      { file: filePath },
      { fileField: 'file', pathField: 'filePath', label: '测试文件' }
    )
    assert.equal(file.name, path.basename(filePath))
    assert.equal(file.buffer.toString('utf8'), 'from file field')
  } finally {
    await fs.rm(filePath, { force: true })
  }
})

test('resolveUploadFile 拒绝同时提供文件对象和路径', async () => {
  await assert.rejects(
    () =>
      resolveUploadFile(
        { file: { dataUrl: 'data:text/plain;base64,aA==' }, filePath: '/tmp/a.txt' },
        { fileField: 'file', pathField: 'filePath', label: '测试文件' }
      ),
    /只能提供一个/
  )
})

test('inferMimeType 使用扩展名兜底', () => {
  assert.equal(inferMimeType('a.pdf'), 'application/pdf')
  assert.equal(inferMimeType('a.unknown'), 'application/octet-stream')
})

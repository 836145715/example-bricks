'use strict'

const GROUPS = Object.freeze(['create', 'read', 'cross-language', 'lifecycle', 'stress'])
const TEST_STATUS = Object.freeze([
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
  'cancelled',
  'waiting-restart'
])

const KiB = 1024
const MiB = 1024 * KiB
const GiB = 1024 * MiB

const catalog = Object.freeze([
  scenario('create-empty', 'create', '创建空资源'),
  scenario('create-text', 'create', '创建 UTF-8 文本资源', { sizeBytes: 1 * KiB }),
  scenario('create-binary', 'create', '创建二进制资源', { sizeBytes: 1 * KiB }),
  scenario('create-unicode-boundary', 'create', 'Unicode 分段边界', { sizeBytes: 1 * MiB }),
  scenario('create-from-stream', 'create', '从流创建资源', { sizeBytes: 8 * MiB }),
  scenario('writer-arbitrary-chunks', 'create', 'Writer 任意块写入', { sizeBytes: 8 * MiB }),
  scenario('writer-finish-state', 'create', 'Writer finish 状态约束'),
  scenario('writer-abort-state', 'create', 'Writer abort 与清理'),
  scenario('read-text', 'read', '整体读取文本'),
  scenario('read-json', 'read', '整体读取 JSON'),
  scenario('read-stream', 'read', '流式读取与哈希', { sizeBytes: 8 * MiB }),
  scenario('read-save-to', 'read', '保存资源到文件', { sizeBytes: 8 * MiB }),
  scenario('read-early-close', 'read', '提前关闭后重新读取'),
  scenario('read-concurrent-rejected', 'read', '拒绝同句柄并发流'),
  scenario('invoke-node', 'cross-language', 'Node 读取与返回', { target: 'node' }),
  scenario('invoke-python', 'cross-language', 'Python 读取与返回', { target: 'python' }),
  scenario('invoke-go', 'cross-language', 'Go 读取与返回', { target: 'go' }),
  scenario('relay-node-python-go', 'cross-language', 'Node 到 Python 到 Go 多跳'),
  scenario('transform-cross-language', 'cross-language', '跨语言变换并返回资源'),
  scenario('event-resource-handle', 'cross-language', '资源事件水合与校验'),
  scenario('resource-revoke', 'lifecycle', '撤销后拒绝读取', { exclusive: true }),
  scenario('resource-ttl', 'lifecycle', 'TTL 到期行为', { exclusive: true }),
  scenario('forged-token', 'lifecycle', '拒绝伪造 capability token', { exclusive: true }),
  scenario('immutable-snapshot', 'lifecycle', 'finish 后不可变快照'),
  scenario('cancel-upload', 'lifecycle', '取消未完成上传并清理', { exclusive: true }),
  scenario('restart-orphan-cleanup', 'lifecycle', '重启清理 orphan', {
    exclusive: true,
    requirements: ['restart']
  }),
  scenario('default-64m-stream', 'stress', '64 MiB 默认大载荷', {
    mode: 'default',
    sizeBytes: 64 * MiB,
    exclusive: true
  }),
  scenario('materialize-201m-rejected', 'stress', '201 MiB 整体读取拒绝', {
    mode: 'stress',
    sizeBytes: 201 * MiB,
    exclusive: true
  }),
  scenario('stream-201m', 'stress', '201 MiB 流式读写', {
    mode: 'stress',
    sizeBytes: 201 * MiB,
    exclusive: true
  }),
  scenario('stream-1g', 'stress', '1 GiB 流式读写', {
    mode: 'stress',
    sizeBytes: 1 * GiB,
    exclusive: true,
    requirements: ['disk-2gib']
  }),
  scenario('slow-reader-decoupled', 'stress', '慢速读取与上传解耦', {
    mode: 'stress',
    sizeBytes: 201 * MiB,
    exclusive: true
  })
])

function scenario(id, group, title, options = {}) {
  return Object.freeze({ id, group, title, mode: 'default', exclusive: false, ...options })
}

function selectScenarios(options = {}) {
  if (Array.isArray(options.ids)) {
    const selected = options.ids.map((id) => catalog.find((item) => item.id === id))
    const missing = options.ids.filter((_, index) => !selected[index])
    if (missing.length > 0) throw new Error(`未知测试场景：${missing.join(', ')}`)
    return selected
  }
  const mode = options.mode ?? 'default'
  if (mode === 'stress') return catalog.filter((item) => item.mode === 'stress')
  if (mode !== 'default') throw new Error(`未知套件模式：${mode}`)
  return catalog.filter((item) => item.mode === 'default')
}

module.exports = { GROUPS, TEST_STATUS, catalog, selectScenarios }

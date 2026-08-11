'use strict'

const SAFE_ERROR_MESSAGES = Object.freeze({
  CANCELLED: '测试已取消。',
  INVALID_INPUT: '测试输入无效。',
  RESOURCE_EXPIRED: '资源已过期或撤销。',
  RESOURCE_LIMIT_EXCEEDED: '资源限制已触发。',
  RESOURCE_MATERIALIZATION_TOO_LARGE: '资源超过整体读取上限。',
  PAYLOAD_TOO_LARGE: '调用载荷超过上限。',
  PERMISSION_DENIED: '资源能力校验失败。',
  BRICK_NOT_FOUND: '测试依赖 Brick 未安装。',
  COMMAND_NOT_FOUND: '测试依赖命令不存在。'
})

function sanitizeResourceRef(ref) {
  if (!ref || typeof ref !== 'object') return undefined
  return compact({
    kind: ref.kind,
    resourceId: ref.resourceId,
    sizeBytes: ref.sizeBytes,
    mimeType: ref.mimeType,
    name: ref.name,
    sha256: ref.sha256,
    expiresAt: ref.expiresAt
  })
}

function sanitizeError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR'
  return {
    code,
    message: SAFE_ERROR_MESSAGES[code] ?? '测试执行失败，详细信息已脱敏。'
  }
}

function createResult(scenario, runId) {
  return {
    runId,
    scenarioId: scenario.id,
    group: scenario.group,
    title: scenario.title,
    target: scenario.target,
    sizeBytes: scenario.sizeBytes,
    exclusive: Boolean(scenario.exclusive),
    status: 'pending'
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

module.exports = {
  SAFE_ERROR_MESSAGES,
  createResult,
  sanitizeError,
  sanitizeResourceRef
}

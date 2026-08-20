'use strict'

const SAFE_ERROR_MESSAGES = Object.freeze({
  CANCELLED: '测试已取消。',
  INVALID_INPUT: '测试输入无效。',
  RESOURCE_EXPIRED: '资源已过期或撤销。',
  RESOURCE_LIMIT_EXCEEDED: '资源限制已触发。',
  RESOURCE_UPLOAD_CLOSED: '资源上传已结束。',
  RESOURCE_ACCESS_DENIED: '资源能力校验失败。',
  RESOURCE_MATERIALIZATION_TOO_LARGE: '资源超过整体读取上限。',
  PAYLOAD_TOO_LARGE: '调用载荷超过上限。',
  PERMISSION_DENIED: '资源能力校验失败。',
  BRICK_NOT_FOUND: '测试依赖 Brick 未安装。',
  COMMAND_NOT_FOUND: '测试依赖命令不存在。'
})

/**
 * 结果摘要用的资源元数据（会进入 suite 快照 / 事件 / command.result）。
 *
 * 注意：0.3.1 起 SDK dehydrate 遇到 `kind: 'brickly.resource'` 但字段不完整
 * （例如故意去掉 accessToken）会抛 INVALID_RESOURCE_REF「ResourceRef 格式无效」。
 * 因此脱敏摘要不得再冒充 wire ResourceRef，改用 resource-summary。
 */
function sanitizeResourceRef(ref) {
  if (!ref || typeof ref !== 'object') return undefined
  return compact({
    kind: 'resource-summary',
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

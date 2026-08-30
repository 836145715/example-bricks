/* eslint-disable */
'use strict'

const { GlmToolsClient } = require('./glm-client')
const { makeError } = require('./errors')

function createAbortSignal(ctx) {
  if (ctx.signal) return ctx.signal
  const abortController = new AbortController()
  ctx.onCancel(() => abortController.abort())
  return abortController.signal
}

function ensureActive(ctx) {
  if (ctx.isCancelled()) throw makeError('CANCELLED', 'Cancelled by host')
}

function createClient(ctx) {
  return new GlmToolsClient(ctx.config || {})
}

function requirePaidConfirmation(input, action) {
  if (!input || input.confirmPaidApiCall !== true) {
    throw makeError(
      'PAID_API_CONFIRMATION_REQUIRED',
      `${action} 会上传文件并触发 BigModel 计费。请确认费用后传入 confirmPaidApiCall=true 再执行。`
    )
  }
}

async function runWithClient(ctx, _progressMessage, fn) {
  const signal = createAbortSignal(ctx)
  const client = createClient(ctx)
  const response = await fn(client, signal)
  ensureActive(ctx)
  return response
}

async function webSearch(ctx, input) {
  const response = await runWithClient(ctx, '调用 GLM 网络搜索', (client, signal) =>
    client.webSearch(input || {}, signal)
  )
  return response
}

async function reader(ctx, input) {
  const response = await runWithClient(ctx, '调用 GLM 网页阅读', (client, signal) =>
    client.reader(input || {}, signal)
  )
  return response
}

async function moderateContent(ctx, input) {
  const response = await runWithClient(ctx, '调用 GLM 内容安全', (client, signal) =>
    client.moderateContent(input || {}, signal)
  )
  return response
}

async function parseFileSync(ctx, input) {
  requirePaidConfirmation(input, '同步文件解析')
  const response = await runWithClient(ctx, '上传并同步解析文件', (client, signal) =>
    client.parseFileSync(input || {}, signal)
  )
  return response
}

async function createFileParseTask(ctx, input) {
  const response = await runWithClient(ctx, '上传文件并创建解析任务', (client, signal) =>
    client.createFileParseTask(input || {}, signal)
  )
  return response
}

async function getFileParseResult(ctx, input) {
  const response = await runWithClient(ctx, '获取文件解析结果', (client, signal) =>
    client.getFileParseResult(input || {}, signal)
  )
  return response
}

async function ocr(ctx, input) {
  const response = await runWithClient(ctx, '上传图片并执行 OCR', (client, signal) =>
    client.ocr(input || {}, signal)
  )
  return response
}

module.exports = {
  webSearch,
  reader,
  moderateContent,
  parseFileSync,
  createFileParseTask,
  getFileParseResult,
  ocr
}

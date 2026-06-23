/* eslint-disable */
'use strict'

const { GlmToolsClient } = require('./glm-client')
const { makeError } = require('./errors')

function createAbortSignal(ctx) {
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

async function runWithClient(ctx, progressMessage, fn) {
  const signal = createAbortSignal(ctx)
  const client = createClient(ctx)
  ctx.progress(0.1, progressMessage)
  const response = await fn(client, signal)
  ensureActive(ctx)
  ctx.progress(0.9, '处理响应')
  return response
}

async function webSearch(ctx, input) {
  const response = await runWithClient(ctx, '调用 GLM 网络搜索', (client, signal) =>
    client.webSearch(input || {}, signal)
  )
  ctx.output('searchResult', response.search_result || [])
  ctx.output('searchIntent', response.search_intent || [])
  ctx.output('response', response)
  ctx.progress(1, '搜索完成')
  return response
}

async function reader(ctx, input) {
  const response = await runWithClient(ctx, '调用 GLM 网页阅读', (client, signal) =>
    client.reader(input || {}, signal)
  )
  const result = response.reader_result || {}
  ctx.output('content', result.content || '')
  ctx.output('readerResult', result)
  ctx.output('response', response)
  ctx.progress(1, '网页读取完成')
  return response
}

async function moderateContent(ctx, input) {
  const response = await runWithClient(ctx, '调用 GLM 内容安全', (client, signal) =>
    client.moderateContent(input || {}, signal)
  )
  const resultList = Array.isArray(response.result_list) ? response.result_list : []
  const riskTypes = [...new Set(resultList.flatMap((item) => item.risk_type || []))]
  ctx.output('riskLevel', resultList[0] ? resultList[0].risk_level || '' : '')
  ctx.output('riskTypes', riskTypes)
  ctx.output('resultList', resultList)
  ctx.output('response', response)
  ctx.output('usage', response.usage || null)
  ctx.progress(1, '内容审核完成')
  return response
}

async function parseFileSync(ctx, input) {
  requirePaidConfirmation(input, '同步文件解析')
  const response = await runWithClient(ctx, '上传并同步解析文件', (client, signal) =>
    client.parseFileSync(input || {}, signal)
  )
  outputParseResult(ctx, response)
  ctx.progress(1, '同步解析完成')
  return response
}

async function createFileParseTask(ctx, input) {
  const response = await runWithClient(ctx, '上传文件并创建解析任务', (client, signal) =>
    client.createFileParseTask(input || {}, signal)
  )
  ctx.output('success', response.success === undefined ? null : response.success)
  ctx.output('message', response.message || '')
  ctx.output('taskId', response.task_id || '')
  ctx.output('response', response)
  ctx.progress(1, '解析任务已创建')
  return response
}

async function getFileParseResult(ctx, input) {
  const response = await runWithClient(ctx, '获取文件解析结果', (client, signal) =>
    client.getFileParseResult(input || {}, signal)
  )
  outputParseResult(ctx, response)
  ctx.progress(1, '解析结果已获取')
  return response
}

async function ocr(ctx, input) {
  const response = await runWithClient(ctx, '上传图片并执行 OCR', (client, signal) =>
    client.ocr(input || {}, signal)
  )
  const wordsResult = Array.isArray(response.words_result) ? response.words_result : []
  const wordsText = wordsResult.map((item) => item.words || '').filter(Boolean).join('\n')
  ctx.output('status', response.status || '')
  ctx.output('message', response.message || '')
  ctx.output('wordsText', wordsText)
  ctx.output('wordsResult', wordsResult)
  ctx.output('taskId', response.task_id || '')
  ctx.output('response', response)
  ctx.progress(1, 'OCR 完成')
  return response
}

function outputParseResult(ctx, response) {
  ctx.output('status', response.status || '')
  ctx.output('message', response.message || '')
  ctx.output('content', response.content || '')
  ctx.output('taskId', response.task_id || '')
  ctx.output('parsingResultUrl', response.parsing_result_url || '')
  ctx.output('response', response)
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

/* eslint-disable */
'use strict'

const { BppError, BricklyRuntime } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.openai'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

let OpenAI = null
let profileConfig = {}

const plugin = new BricklyRuntime({ brickId: BRICK_ID })

function makeError(code, message) {
  return new BppError(code, message)
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonInput(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (error) {
      throw makeError('INVALID_INPUT', `${fieldName} must be valid JSON: ${error.message}`)
    }
  }
  return value
}

function getConfigValue(name, envName) {
  return optionalString(profileConfig[name]) || optionalString(process.env[envName])
}

function getApiKey() {
  const apiKey = getConfigValue('apiKey', 'OPENAI_API_KEY')
  if (!apiKey) {
    throw makeError('INVALID_CONFIG', 'OpenAI API Key is required in the selected plugin Profile')
  }
  return apiKey
}

function getDefaultModel() {
  return optionalString(profileConfig.defaultModel) || 'gpt-5'
}

function loadOpenAI() {
  if (OpenAI) return OpenAI
  try {
    const mod = require('openai')
    OpenAI = mod.default || mod.OpenAI || mod
    return OpenAI
  } catch (error) {
    throw makeError(
      'SDK_MISSING',
      `OpenAI Node SDK is not installed in runtime/node. Run npm install in the plugin runtime folder. Original error: ${error.message}`
    )
  }
}

function createClient() {
  const Client = loadOpenAI()
  const organization = getConfigValue('organization', 'OPENAI_ORG_ID')
  const project = getConfigValue('project', 'OPENAI_PROJECT_ID')
  return new Client({
    apiKey: getApiKey(),
    baseURL: getConfigValue('baseUrl', 'OPENAI_BASE_URL') || DEFAULT_BASE_URL,
    organization: organization || undefined,
    project: project || undefined
  })
}

function buildResponsesBody(input) {
  const extraBody = parseJsonInput(input.extraBody, 'extraBody')
  if (extraBody !== undefined && !isObject(extraBody)) {
    throw makeError('INVALID_INPUT', 'extraBody must be a JSON object')
  }

  if (input.input === undefined || input.input === null || input.input === '') {
    throw makeError('INVALID_INPUT', 'input is required')
  }

  const body = {
    model: optionalString(input.model) || getDefaultModel(),
    input: input.input
  }
  const instructions = optionalString(input.instructions)
  const previousResponseId = optionalString(input.previousResponseId)
  const maxOutputTokens = numberOrUndefined(input.maxOutputTokens)
  const temperature = numberOrUndefined(input.temperature)

  if (instructions) body.instructions = instructions
  if (previousResponseId) body.previous_response_id = previousResponseId
  if (maxOutputTokens !== undefined) body.max_output_tokens = maxOutputTokens
  if (temperature !== undefined) body.temperature = temperature
  if (input.stream === true) body.stream = true

  return { ...body, ...(extraBody || {}) }
}

function buildChatBody(input) {
  const messages = parseJsonInput(input.messages, 'messages')
  if (!Array.isArray(messages)) {
    throw makeError('INVALID_INPUT', 'messages must be a JSON array')
  }

  const extraBody = parseJsonInput(input.extraBody, 'extraBody')
  if (extraBody !== undefined && !isObject(extraBody)) {
    throw makeError('INVALID_INPUT', 'extraBody must be a JSON object')
  }

  const body = {
    model: optionalString(input.model) || getDefaultModel(),
    messages
  }
  const maxCompletionTokens = numberOrUndefined(input.maxCompletionTokens)
  const temperature = numberOrUndefined(input.temperature)

  if (maxCompletionTokens !== undefined) body.max_completion_tokens = maxCompletionTokens
  if (temperature !== undefined) body.temperature = temperature
  if (input.stream === true) body.stream = true
  if (input.store === true) body.store = true

  return { ...body, ...(extraBody || {}) }
}

function extractResponseText(response) {
  if (!response || typeof response !== 'object') return ''
  if (typeof response.output_text === 'string') return response.output_text
  if (!Array.isArray(response.output)) return ''

  const parts = []
  for (const item of response.output) {
    if (!item || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (typeof content.text === 'string') parts.push(content.text)
      else if (typeof content.output_text === 'string') parts.push(content.output_text)
    }
  }
  return parts.join('')
}

function extractChatText(response) {
  const message = response && response.choices && response.choices[0] && response.choices[0].message
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part && (part.text || part.content || ''))
      .filter(Boolean)
      .join('')
  }
  return ''
}

function normalizeOpenAIError(error) {
  if (!error) return makeError('INTERNAL_ERROR', 'Unknown OpenAI SDK error')
  if (error.code && error.message) return error
  const status = error.status || error.response?.status
  const code = error.code || error.type || (status ? `OPENAI_HTTP_${status}` : 'OPENAI_SDK_ERROR')
  const message = error.message || String(error)
  return makeError(code, message)
}

async function runResponses(ctx, input) {
  const client = createClient()
  const body = buildResponsesBody(input || {})
  const abortController = new AbortController()
  ctx.onCancel(() => abortController.abort())
  ctx.progress(0.1, 'Calling OpenAI Responses API')

  if (body.stream) {
    let text = ''
    const stream = client.responses.stream(body, { signal: abortController.signal })

    for await (const event of stream) {
      if (ctx.isCancelled()) throw makeError('CANCELLED', 'Cancelled by host')
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta
        ctx.chunk(event.delta, 'text')
      } else if (event.type === 'response.failed') {
        const message = event.response?.error?.message || 'OpenAI Responses stream failed'
        throw makeError('OPENAI_API_ERROR', message)
      }
    }

    const finalResponse = await stream.finalResponse()
    if (!text) text = extractResponseText(finalResponse)
    ctx.output('text', text)
    ctx.output('response', finalResponse)
    ctx.output('usage', finalResponse && finalResponse.usage ? finalResponse.usage : null)
    ctx.progress(1, 'OpenAI response received')
    return { text, response: finalResponse }
  }

  const response = await client.responses.create(body, { signal: abortController.signal })
  const text = extractResponseText(response)
  ctx.output('text', text)
  ctx.output('response', response)
  ctx.output('usage', response && response.usage ? response.usage : null)
  ctx.progress(1, 'OpenAI response received')
  return { text, response }
}

async function runChatCompletions(ctx, input) {
  const client = createClient()
  const body = buildChatBody(input || {})
  const abortController = new AbortController()
  ctx.onCancel(() => abortController.abort())
  ctx.progress(0.1, 'Calling OpenAI Chat Completions API')

  if (body.stream) {
    let text = ''
    const stream = client.chat.completions.stream(body, { signal: abortController.signal })

    for await (const chunk of stream) {
      if (ctx.isCancelled()) throw makeError('CANCELLED', 'Cancelled by host')
      const choice = chunk.choices && chunk.choices[0]
      const delta = choice && choice.delta
      if (delta && typeof delta.content === 'string') {
        text += delta.content
        ctx.chunk(delta.content, 'text')
      }
    }

    const response = await stream.finalChatCompletion()
    const message = response && response.choices && response.choices[0] ? response.choices[0].message : null
    if (!text) text = extractChatText(response)
    ctx.output('text', text)
    ctx.output('message', message)
    ctx.output('response', response)
    ctx.output('usage', response && response.usage ? response.usage : null)
    ctx.progress(1, 'OpenAI chat completion received')
    return { text, message, response }
  }

  const response = await client.chat.completions.create(body, {
    signal: abortController.signal
  })
  const text = extractChatText(response)
  const message = response && response.choices && response.choices[0] ? response.choices[0].message : null
  ctx.output('text', text)
  ctx.output('message', message)
  ctx.output('response', response)
  ctx.output('usage', response && response.usage ? response.usage : null)
  ctx.progress(1, 'OpenAI chat completion received')
  return { text, message, response }
}

plugin.onCommand('responses', async (ctx, input) => {
  try {
    return await runResponses(ctx, input || {})
  } catch (error) {
    throw normalizeOpenAIError(error)
  }
})

plugin.onCommand('chat-completions', async (ctx, input) => {
  try {
    return await runChatCompletions(ctx, input || {})
  } catch (error) {
    throw normalizeOpenAIError(error)
  }
})

plugin.transport.on('message', (message) => {
  if (message && message.type === 'host.hello') {
    profileConfig = message.config || {}
  }
})

plugin.start()

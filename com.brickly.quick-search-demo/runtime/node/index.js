/* eslint-disable */
'use strict'

const BRICK_ID = 'com.brickly.quick-search-demo'
const PROTOCOL_VERSION = '0.1.0'

let buffer = ''
const cancelled = new Set()

const DEMO_ITEMS = [
  {
    id: 'open-demo-dashboard',
    title: '打开演示 Dashboard',
    subtitle: '来自工具 provider 的快速启动结果',
    accessory: 'Quick Launch',
    category: 'quick-launch',
    score: 94,
    keywords: ['demo', 'provider', 'quick', 'dashboard', '演示', '快速搜索'],
    actionIds: ['open-dashboard', 'copy-dashboard-link'],
    activationData: { action: 'open-demo-dashboard' }
  },
  {
    id: 'provider-docs',
    title: '查看 Provider 契约',
    subtitle: 'manifest.quickSearch.providers 示例',
    accessory: 'Docs',
    category: 'command',
    score: 88,
    keywords: ['provider', 'quick-search', 'manifest', 'docs', '契约'],
    actionIds: ['open-provider-contract'],
    activationData: { action: 'open-provider-docs' }
  },
  {
    id: 'sample-file-result',
    title: 'quick-search-demo.txt',
    subtitle: 'D:/ai-bricks/examples/quick-search-demo.txt',
    accessory: 'File',
    category: 'file',
    score: 76,
    keywords: ['file', 'demo', 'txt', '文件', 'provider'],
    dedupeKey: 'file:D:/ai-bricks/examples/quick-search-demo.txt',
    actionIds: ['reveal-demo-file', 'copy-demo-path'],
    activationData: { path: 'D:/ai-bricks/examples/quick-search-demo.txt' }
  }
]

const ACTION_TITLES = {
  'open-dashboard': '打开 Dashboard',
  'copy-dashboard-link': '复制 Dashboard 链接',
  'open-provider-contract': '查看 Provider 契约',
  'reveal-demo-file': '在文件夹中显示',
  'copy-demo-path': '复制文件路径'
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function log(message, details) {
  process.stderr.write(`[${BRICK_ID}] ${message}${details ? ' ' + JSON.stringify(details) : ''}\n`)
}

function normalizeQuery(input) {
  return String(input && input.query ? input.query : '').trim().toLocaleLowerCase()
}

function searchDemo(input) {
  const query = normalizeQuery(input)
  const limit = Number.isInteger(input && input.limit) ? Math.max(1, Math.min(10, input.limit)) : 5
  const tokens = query.split(/\s+/).filter(Boolean)
  const results = DEMO_ITEMS.filter((item) => {
    if (tokens.length === 0) return false
    const haystack = [item.id, item.title, item.subtitle, item.accessory, ...item.keywords]
      .join(' ')
      .toLocaleLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
    .slice(0, limit)
    .map(({ keywords, ...item }) => item)
  return { results }
}

function activateDemo(input) {
  const result = input && input.result && typeof input.result === 'object' ? input.result : {}
  return {
    message: `已激活演示结果：${result.title || result.id || 'unknown'}`,
    receivedActivationData: result.activationData
  }
}

function actionDemo(input) {
  const result = input && input.result && typeof input.result === 'object' ? input.result : {}
  const actionId = String(input && input.actionId ? input.actionId : '')
  return {
    message: `已执行演示动作：${ACTION_TITLES[actionId] || actionId || 'unknown'} · ${
      result.title || result.id || 'unknown'
    }`,
    receivedActivationData: result.activationData
  }
}

async function handleInvoke(message) {
  const { id, commandId, input = {} } = message
  if (cancelled.has(id)) return
  try {
    let result
    if (commandId === 'search-demo') result = searchDemo(input)
    else if (commandId === 'activate-demo') result = activateDemo(input)
    else if (commandId === 'action-demo') result = actionDemo(input)
    else {
      send({
        type: 'command.error',
        id,
        error: { code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${commandId}` }
      })
      return
    }
    send({ type: 'command.result', id, result })
  } catch (error) {
    send({
      type: 'command.error',
      id,
      error: {
        code: error && error.code ? error.code : 'INTERNAL_ERROR',
        message: error && error.message ? error.message : String(error)
      }
    })
  } finally {
    cancelled.delete(id)
  }
}

function onMessage(message) {
  if (message.type === 'host.hello') {
    send({ type: 'runtime.ready', protocolVersion: PROTOCOL_VERSION, brickId: BRICK_ID })
  } else if (message.type === 'runtime.ping') {
    send({ type: 'runtime.pong', id: message.id })
  } else if (message.type === 'command.cancel') {
    cancelled.add(message.id)
  } else if (message.type === 'command.invoke') {
    void handleInvoke(message)
  } else if (message.type === 'runtime.shutdown') {
    send({ type: 'runtime.bye' })
    process.exit(0)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      onMessage(JSON.parse(line))
    } catch (error) {
      log('invalid message', { error: error && error.message ? error.message : String(error) })
    }
  }
})

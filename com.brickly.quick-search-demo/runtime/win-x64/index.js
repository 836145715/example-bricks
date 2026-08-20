/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.quick-search-demo'
const brick = new BricklyRuntime({ brickId: BRICK_ID })

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

brick.onCommand('search-demo', async (_ctx, input = {}) => searchDemo(input))
brick.onCommand('activate-demo', async (_ctx, input = {}) => activateDemo(input))
brick.onCommand('action-demo', async (_ctx, input = {}) => actionDemo(input))

brick.start()

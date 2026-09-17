/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.quick-search-demo'
const brick = new BricklyRuntime()

const DEMO_ITEMS = [
  {
    id: 'open-demo-dashboard',
    title: '打开演示 Dashboard',
    subtitle: '来自工具 provider 的快速启动结果',
    accessory: 'Quick Launch',
    category: 'quick-launch',
    score: 94,
    keywords: ['demo', 'provider', 'quick', 'dashboard', '演示', '快速搜索'],
    activate: {
      command: 'activate-demo',
      input: { action: 'open-demo-dashboard', title: '打开演示 Dashboard' }
    },
    actions: [
      {
        id: 'open-dashboard',
        title: '打开 Dashboard',
        command: 'action-demo',
        input: { actionId: 'open-dashboard', title: '打开演示 Dashboard' }
      },
      {
        id: 'copy-dashboard-link',
        title: '复制 Dashboard 链接',
        command: 'action-demo',
        input: { actionId: 'copy-dashboard-link', title: '打开演示 Dashboard' }
      }
    ]
  },
  {
    id: 'provider-docs',
    title: '查看 Provider 契约',
    subtitle: 'commands[].provider 标记示例',
    accessory: 'Docs',
    category: 'command',
    score: 88,
    keywords: ['provider', 'quick-search', 'manifest', 'docs', '契约'],
    activate: {
      command: 'activate-demo',
      input: { action: 'open-provider-docs', title: '查看 Provider 契约' }
    },
    actions: [
      {
        id: 'open-provider-contract',
        title: '查看 Provider 契约',
        command: 'action-demo',
        input: { actionId: 'open-provider-contract', title: '查看 Provider 契约' }
      }
    ]
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
    activate: {
      command: 'activate-demo',
      input: {
        action: 'open-demo-file',
        path: 'D:/ai-bricks/examples/quick-search-demo.txt',
        title: 'quick-search-demo.txt'
      }
    },
    actions: [
      {
        id: 'reveal-demo-file',
        title: '在文件夹中显示',
        command: 'action-demo',
        input: {
          actionId: 'reveal-demo-file',
          path: 'D:/ai-bricks/examples/quick-search-demo.txt',
          title: 'quick-search-demo.txt'
        }
      },
      {
        id: 'copy-demo-path',
        title: '复制文件路径',
        command: 'action-demo',
        input: {
          actionId: 'copy-demo-path',
          path: 'D:/ai-bricks/examples/quick-search-demo.txt',
          title: 'quick-search-demo.txt'
        }
      }
    ]
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

// activate / actions[] 路由的 input 是 provider 自填载荷，宿主直传给目标命令。
function activateDemo(input) {
  const title = input && typeof input.title === 'string' ? input.title : ''
  const action = input && typeof input.action === 'string' ? input.action : ''
  return { message: `已激活演示结果：${title || action || 'unknown'}` }
}

function actionDemo(input) {
  const actionId = String(input && input.actionId ? input.actionId : '')
  const title = input && typeof input.title === 'string' ? input.title : ''
  return {
    message: `已执行演示动作：${ACTION_TITLES[actionId] || actionId || 'unknown'} · ${
      title || 'unknown'
    }`
  }
}

brick.onCommand('search-demo', async (_ctx, input = {}) => searchDemo(input))
brick.onCommand('activate-demo', async (_ctx, input = {}) => activateDemo(input))
brick.onCommand('action-demo', async (_ctx, input = {}) => actionDemo(input))

brick.start()

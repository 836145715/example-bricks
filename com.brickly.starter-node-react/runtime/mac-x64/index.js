/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')


const brick = new BricklyRuntime({ brickId: 'com.brickly.starter-node-react' })
const toolDependencies = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function textStats(text) {
  const words = text.trim() ? text.trim().split(/\s+/u) : []
  const lines = text.length ? text.split(/\r\n|\r|\n/u) : []
  return { characters: [...text].length, words: words.length, lines: lines.length }
}

function parseJson(input) {
  if (typeof input === 'string') return JSON.parse(input)
  return input
}

brick.onCommand('hello', async (ctx, input) => {
  const name = String((input && input.name) || 'Brickly')

  return {
    ok: true,
    runtime: 'node',
    message: `Hello, ${name}!`,
    dependencies: toolDependencies
  }
})

brick.onCommand('analyze-text', async (_ctx, input) => {
  const text = String((input && input.text) || '')
  return {
    runtime: 'node',
    stats: textStats(text),
    transforms: {
      uppercase: text.toUpperCase(),
      lowercase: text.toLowerCase(),
      preview: text.slice(0, 120)
    }
  }
})

brick.onCommand('transform-json', async (_ctx, input) => {
  const value = parseJson((input && input.json) || '{}')
  const objectValue = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    runtime: 'node',
    valid: true,
    type: Array.isArray(value) ? 'array' : typeof value,
    keys: Object.keys(objectValue),
    pretty: JSON.stringify(value, null, 2),
    compact: JSON.stringify(value)
  }
})

brick.onCommand('stream-demo', async (ctx, input) => {
  const topic = String((input && input.topic) || 'Brickly SDK')
  const parts = [
    `# ${topic}\n\n`,
    '这是一个 call 示例。\n',
    '- progress 用来展示进度。\n',
    '- chunk 用来追加文本片段。\n',
    '- return 用来给出最终结果。\n'
  ]
  let text = ''
  for (let index = 0; index < parts.length; index += 1) {
    if (ctx.isCancelled()) throw new Error('已被宿主取消')
    const part = parts[index]
    text += part
    await ctx.send({ type: 'chunk', chunk: part, name: 'text' })
    await ctx.send({
      type: 'progress',
      progress: (index + 1) / parts.length,
      message: `生成片段 ${index + 1}/${parts.length}`
    })
    await sleep(250)
  }
  return { ok: true, topic, length: text.length, text }
})

brick.onCommand('generate-report', async (_ctx, input) => {
  const title = String((input && input.title) || '工具报告')
  const notes = String((input && input.notes) || '')
  const points = notes.split(/\r\n|\r|\n/u).map((item) => item.trim()).filter(Boolean)
  return `# ${title}\n\n${points.map((item) => `- ${item}`).join('\n')}\n\n## Summary\n\n- Runtime: node\n- Point count: ${points.length}\n`
})

brick.start()

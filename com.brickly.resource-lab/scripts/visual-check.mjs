import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const url = process.env.RESOURCE_LAB_URL ?? 'http://127.0.0.1:4317/'
const executablePath = process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = resolve('test-results', 'visual')
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'compact', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 }
]

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(mockBridge)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.locator('.result-row').first().click()
    await page.screenshot({ path: resolve(outputDir, `${viewport.name}.png`), fullPage: true })
    const metrics = await page.evaluate(() => ({
      title: document.querySelector('h1')?.textContent,
      rows: document.querySelectorAll('.result-row').length,
      width: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyHeight: document.body.getBoundingClientRect().height
    }))
    if (metrics.title !== '资源验收测试台') throw new Error(`${viewport.name}: 页面未渲染。`)
    if (metrics.rows < 4) throw new Error(`${viewport.name}: 模拟结果未显示。`)
    if (metrics.width > metrics.viewportWidth + 1) throw new Error(`${viewport.name}: 横向溢出 ${metrics.width - metrics.viewportWidth}px。`)
    if (metrics.bodyHeight < viewport.height * 0.9) throw new Error(`${viewport.name}: 页面高度异常。`)
    if (errors.length) throw new Error(`${viewport.name}: 控制台错误：${errors.join(' | ')}`)
    console.log(`${viewport.name}: ${viewport.width}x${viewport.height}, rows=${metrics.rows}, overflow=0`)
    await page.close()
  }
} finally {
  await browser.close()
}

function mockBridge() {
  const scenarios = [
    ['create-text', 'create', '创建 UTF-8 文本资源', 'default', false, 1024],
    ['read-stream', 'read', '流式读取与哈希', 'default', false, 8388608],
    ['invoke-python', 'cross-language', 'Python 读取与返回', 'default', false, 1024],
    ['relay-node-python-go', 'cross-language', 'Node 到 Python 到 Go 多跳', 'default', false, 8388608],
    ['resource-ttl', 'lifecycle', 'TTL 到期行为', 'default', true, 1024],
    ['default-64m-stream', 'stress', '64 MiB 默认大载荷', 'default', true, 67108864],
    ['stream-201m', 'stress', '201 MiB 流式读写', 'stress', true, 210763776],
    ['stream-1g', 'stress', '1 GiB 流式读写', 'stress', true, 1073741824]
  ].map(([id, group, title, mode, exclusive, sizeBytes]) => ({ id, group, title, mode, exclusive, sizeBytes }))
  const startedAt = Date.now() - 3200
  const snapshot = {
    runId: 'window-demo-09c8fd7a', mode: 'default', status: 'running', startedAt,
    results: scenarios.slice(0, 6).map((scenario, index) => ({
      runId: 'window-demo-09c8fd7a', scenarioId: scenario.id, group: scenario.group,
      title: scenario.title, sizeBytes: scenario.sizeBytes, exclusive: scenario.exclusive,
      target: index === 2 ? 'python' : undefined,
      status: ['passed', 'passed', 'failed', 'passed', 'running', 'pending'][index],
      startedAt, finishedAt: index < 4 ? startedAt + 1200 + index * 400 : undefined,
      durationMs: index < 4 ? 1200 + index * 400 : undefined,
      throughputBytesPerSecond: index < 4 ? 4194304 * (index + 1) : undefined,
      sha256: index < 4 ? '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' : undefined,
      chunkCount: index < 4 ? index + 1 : undefined,
      hops: index === 3 ? ['resource-lab', 'node', 'python', 'go'] : undefined,
      error: index === 2 ? { code: 'DEPENDENCY_UNAVAILABLE', message: '测试依赖 Runtime 暂不可用，详细信息已脱敏。' } : undefined
    }))
  }
  const invoke = async (command, input) => {
    if (command === 'suite-list') return { groups: ['create', 'read', 'cross-language', 'lifecycle', 'stress'], scenarios }
    if (command === 'suite-status') return input?.runId ? snapshot : { runs: [snapshot] }
    if (command === 'restart-verify') return { status: 'skipped' }
    if (command === 'suite-run') return { runId: input.runId, status: 'running' }
    if (command === 'suite-cancel') return { ...snapshot, status: 'cancelled' }
    if (command === 'restart-prepare') return { status: 'waiting-restart', runId: input.runId, preparedAt: Date.now(), checkpoint: { runId: input.runId, pid: 1, nonce: 'visual', preparedAt: Date.now() } }
    if (command === 'suite-export') return { text: async () => JSON.stringify(snapshot), close: async () => {}, revoke: async () => {} }
    throw new Error(`未知模拟命令：${command}`)
  }
  window.brickly = {
    invoke,
    stream: (_command, _input, callbacks) => ({ cancel: () => callbacks.onError?.({ code: 'CANCELLED' }) }),
    service: { start: async () => ({ running: true }) },
    events: { subscribe: async () => () => {} }
  }
}

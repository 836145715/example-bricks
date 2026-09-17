/**
 * Quick Search Brick —— Node runtime 主进程逻辑。
 *
 * 职责：
 * - 持有唯一的常驻搜索浮窗（Session keepAlive 绑定，随实例存活）；
 * - `toggle` 命令（热键直调入口）：首次创建即展示（keepAlive 窗创建时必须
 *   展示——契约约束），再次触发按可见性切换；
 * - 页面请求中转：`search.*` 经 expose 调到 `brick.platform.search.*`；
 * - 渐进快照：`search:snapshot` 定向事件 → `win.send('snapshot')` 推给页面；
 * - 拖拽：`drag.start`/`drag.end` 经 expose 调到通用 `win.startDrag()/endDrag()`；
 * - blur 自动隐藏；拖动后保留位置，不再强制居中。
 *
 * 页面↔runtime 通道：页面用 `window.brickly`（brick-child preload 注入）的
 * `request(name)/notify(name)` 调 expose 的同名 handler；runtime 用
 * `win.send(name, payload)` 推 `brickly.on(name)`。
 */
import { BricklyRuntime, type WindowHandle } from '@syllm/brickly-sdk'

const brick = new BricklyRuntime()

/** 浮窗外观约束（沿用宿主原实现）。 */
const WINDOW_SIZE = {
  width: 720,
  height: 460,
  minWidth: 520,
  minHeight: 180,
  maxWidth: 920,
  maxHeight: 680
} as const

let win: WindowHandle | undefined
/** createBrowserWindow 的在途调用：并发 toggle/activate 复用同一 Promise，防双创建。 */
let creating: Promise<WindowHandle> | undefined
/** 用户拖动后的窗口位置：一经拖动，后续 show 沿用此位置而不再居中。 */
let userPosition: { x: number; y: number } | undefined
/** 单调递增的查询序号：页面每次输入变更发起新 query，用于快照/结果对齐。 */
let sequence = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringField(payload: unknown, key: string): string {
  const value = isRecord(payload) ? payload[key] : undefined
  if (typeof value !== 'string' || !value) {
    throw Object.assign(new Error(`${key} 必须是非空字符串`), { code: 'INVALID_INPUT' })
  }
  return value
}

/**
 * 快照转发：sequence 不匹配当前查询轮次的快照丢弃；
 * 不带 sequence 的快照（非本会话来源）不过滤——宿主快照契约总带 sequence。
 */
function forwardSnapshot(snapshot: unknown): void {
  if (!win || win.isClosed) return
  const seq = isRecord(snapshot) ? snapshot.sequence : undefined
  if (typeof seq === 'number' && seq !== sequence) return
  void win.send('snapshot', snapshot).catch(() => undefined)
}

/** 发起一轮搜索：渐进快照走 search:snapshot 事件，blocking 终帧作兜底补发。 */
function runQuery(payload: unknown): void {
  const query =
    typeof (isRecord(payload) ? payload.query : undefined) === 'string'
      ? (payload as { query: string }).query
      : ''
  sequence += 1
  const mine = sequence
  void brick.platform.search
    .query({ query, sequence: mine, limit: 24 })
    .then((final) => {
      // 事件通道丢帧时页面也能收终帧；重复推送对页面是幂等覆盖。
      if (mine === sequence && final) forwardSnapshot(final)
    })
    .catch((error) => {
      brick.log.warn('search.query 调用失败', {
        sequence: mine,
        error: error instanceof Error ? error.message : error
      })
      forwardSnapshot({
        query,
        sequence: mine,
        results: [],
        providerStates: [],
        complete: true,
        generatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      })
    })
}

/** 激活/执行动作后作废旧轮快照：防止已清空的列表被晚到的渐进帧闪回。 */
function expireSnapshots(): void {
  sequence += 1
}

function ensureWindow(): Promise<WindowHandle> {
  if (win && !win.isClosed) return Promise.resolve(win)
  creating ??= createWindow().finally(() => {
    creating = undefined
  })
  return creating
}

/** 建窗前的目标位置：优先沿用拖动后的位置，否则光标所在屏居中偏上。 */
async function desiredPalettePosition(): Promise<{ x: number; y: number } | undefined> {
  if (userPosition) return userPosition
  try {
    const point = await brick.platform.screen.getCursorScreenPoint()
    const display = await brick.platform.screen.getDisplayNearestPoint(point)
    const area = display.workArea
    return {
      x: Math.round(area.x + (area.width - WINDOW_SIZE.width) / 2),
      y: Math.round(area.y + Math.max(72, area.height * 0.18))
    }
  } catch (error) {
    // 取不到屏幕信息时交给宿主默认位置，不阻断创建。
    brick.log.warn('浮窗定位失败，使用默认位置', {
      error: error instanceof Error ? error.message : error
    })
    return undefined
  }
}

async function createWindow(): Promise<WindowHandle> {
  // keepAlive 窗口创建时必须展示（宿主契约）：位置在建前算好随 options 传入，
  // 避免"先建后移"的闪动；拖动过的位置经 userPosition 复用。
  const position = await desiredPalettePosition()
  const created = await brick.ui.createBrowserWindow('ui/index.html', {
    // Session + keepAlive：窗口随常驻实例存活，不随 toggle 这次调用结束而关。
    keepAlive: true,
    show: true,
    ...(position ?? {}),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: '快速搜索',
    backgroundColor: '#00000000',
    hasShadow: false,
    ...WINDOW_SIZE
  })

  // 页面 → runtime 的调用面（brickly.request/notify 同名派发）。
  created.expose({
    'search.query': (payload) => {
      runQuery(payload)
      return { accepted: true }
    },
    'search.activate': (payload) => {
      expireSnapshots()
      return brick.platform.search.activate(stringField(payload, 'resultId'))
    },
    'search.runAction': (payload) => {
      expireSnapshots()
      return brick.platform.search.runAction(
        stringField(payload, 'resultId'),
        stringField(payload, 'actionId')
      )
    },
    'window.hide': () => created.hide(),
    'drag.start': () => created.startDrag(),
    'drag.end': async () => {
      await created.endDrag()
      try {
        // 拖拽结束后记住位置：后续 show 沿用，不再强制居中。
        const [x, y] = await created.getPosition()
        userPosition = { x, y }
      } catch {
        // 拖拽收尾时窗口可能已销毁——位置不存不算错误。
      }
    }
  })

  created.on('blur', () => {
    void created.hide().catch(() => undefined)
  })
  created.on('closed', () => {
    if (win === created) win = undefined
  })

  win = created
  return created
}

/** 已存在窗口的再展示：摆位置 → show → focus → 通知页面复位。 */
async function showPalette(window: WindowHandle): Promise<void> {
  if (await window.isMinimized()) await window.restore()
  const position = await desiredPalettePosition()
  if (position) await window.setPosition(position.x, position.y)
  await window.show()
  await window.focus()
  // 页面复位输入框并聚焦（页面侧 brickly.on('shown')）。
  await window.send('shown')
}

brick.onCommand('toggle', async () => {
  const existed = Boolean(win && !win.isClosed)
  const window = await ensureWindow()
  if (existed && (await window.isVisible())) {
    await window.hide()
    return { visible: false }
  }
  if (existed) {
    await showPalette(window)
  } else {
    // 新建窗已随创建展示：聚焦 + 通知页面复位输入框。
    await window.focus()
    await window.send('shown')
  }
  return { visible: true }
})

// 宿主把该实例发起查询的渐进快照定向推回本实例；过期轮次在 forwardSnapshot 里滤掉。
brick.events.on('search:snapshot', forwardSnapshot)

brick.start()

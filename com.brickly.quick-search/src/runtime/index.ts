/**
 * Quick Search Brick —— Node runtime 主进程逻辑。
 *
 * 职责：
 * - 持有唯一的常驻搜索浮窗（Session keepAlive 绑定，随实例存活）；
 * - `toggle` 命令（热键直调入口）：onReady 预热建窗停屏外，唤起/停靠纯位移零动画；
 * - 页面请求中转：`search.*` 经 expose 调到 `brick.platform.search.*`；
 * - 渐进快照：`platform.search.query` 的 CallStream 逐帧 → `win.send('snapshot')` 推页面；
 *   新查询 abort 旧流（流取消即宿主侧 abort 搜索会话）；
 * - 拖拽：`drag.start`/`drag.end` 经 expose 调到通用 `win.startDrag()/endDrag()`；
 * - blur 自动停靠屏外；拖动后保留位置，不再强制居中。
 *
 * 显隐实现（关键）：Windows 对透明无边框窗口的每次 hidden→shown 都强制播放
 * 约 300ms 的 DWM 淡入（electron#45730 佐证 OS 动画参与透明窗显隐），DOM 层
 * 无法关闭，表现为唤起卡顿。因此窗口创建后永不 hide()/show()：建窗即停在屏外
 * PARKED_POSITION 播掉唯一一次淡入，之后"显示"= setPosition 移回屏内、
 * "隐藏"= setPosition 停回屏外，都是原子 SetWindowPos 位移。OS 视角窗口恒
 * visible，逻辑显隐由 paletteVisible 记账。
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

/** 屏外停靠位：经典 Win32 隐藏窗角落，任何显示器布局下都在所有物理屏之外。 */
const PARKED_POSITION = { x: -32000, y: -32000 } as const

let win: WindowHandle | undefined
/** createBrowserWindow 的在途调用：并发 toggle/activate 复用同一 Promise，防双创建。 */
let creating: Promise<WindowHandle> | undefined
/** 用户拖动后的窗口位置：一经拖动，后续唤出沿用此位置而不再居中。 */
let userPosition: { x: number; y: number } | undefined
/** 逻辑可见性：窗口在 OS 层恒 visible（停靠屏外不算隐藏），显隐由本标志记账。 */
let paletteVisible = false
/** 单调递增的查询序号：页面每次输入变更发起新 query，用于快照/结果对齐。 */
let sequence = 0
/** 在途搜索流的取消句柄：新查询/激活动作 abort 它，流取消即宿主侧终止会话。 */
let currentQuery: AbortController | undefined

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

/** 发起一轮搜索：CallStream 逐帧推页面；新查询 abort 旧流取代旧会话。 */
function runQuery(payload: unknown): void {
  const query =
    typeof (isRecord(payload) ? payload.query : undefined) === 'string'
      ? (payload as { query: string }).query
      : ''
  sequence += 1
  const mine = sequence
  currentQuery?.abort()
  const abort = new AbortController()
  currentQuery = abort
  void (async () => {
    try {
      for await (const snapshot of brick.platform.search.query(
        { query, sequence: mine, limit: 10 },
        { signal: abort.signal }
      )) {
        // 晚于本轮的流帧已被更新的查询取代——丢弃。
        if (mine !== sequence) return
        forwardSnapshot(snapshot)
      }
    } catch (error) {
      if (abort.signal.aborted) return
      brick.log.warn('search.query 流式调用失败', {
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
    } finally {
      if (currentQuery === abort) currentQuery = undefined
    }
  })()
}

/** 激活/执行动作后终止在途搜索并作废旧轮快照：防止已清空的列表被晚到帧闪回。 */
function expireSnapshots(): void {
  sequence += 1
  currentQuery?.abort()
  currentQuery = undefined
}

function ensureWindow(): Promise<WindowHandle> {
  if (win && !win.isClosed) return Promise.resolve(win)
  creating ??= createWindow().finally(() => {
    creating = undefined
  })
  return creating
}

/** 唤出前的目标位置：优先沿用拖动后的位置，否则光标所在屏居中偏上。 */
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
  // keepAlive 支持隐藏创建（宿主不强制建时展示）：show:false 建窗后立刻
  // showInactive 停到屏外——把 Windows 对透明窗的强制淡入耗在不可见区，
  // 且 showInactive 不抢焦点；此后窗口永不 hide/show，只靠 setPosition 停靠/唤出。
  const created = await brick.ui.createBrowserWindow('ui/index.html', {
    // Session + keepAlive：窗口随常驻实例存活，不随 toggle 这次调用结束而关。
    keepAlive: true,
    show: false,
    x: PARKED_POSITION.x,
    y: PARKED_POSITION.y,
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
  // 唯一一次 hidden→shown 转换：OS 淡入播在屏外；showInactive 不抢焦点。
  await created.showInactive()
  paletteVisible = false

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
    // 页面请求"隐藏"（如 Escape）：实为停靠屏外——窗口永不 hide，见文件头说明。
    'window.hide': () => enqueuePaletteTransition(() => parkPalette(created)),
    'drag.start': () => created.startDrag(),
    'drag.end': async () => {
      await created.endDrag()
      try {
        // 拖拽结束后记住位置：后续唤出沿用，不再强制居中。
        const [x, y] = await created.getPosition()
        userPosition = { x, y }
      } catch {
        // 拖拽收尾时窗口可能已销毁——位置不存不算错误。
      }
    }
  })

  created.on('blur', () => {
    void enqueuePaletteTransition(() => parkPalette(created)).catch(() => undefined)
  })
  created.on('closed', () => {
    if (win === created) {
      win = undefined
      paletteVisible = false
    }
  })

  win = created
  return created
}

/**
 * 显隐切换串行化：热键连打/blur 与 toggle 交错时，park/show 的原子位移按入队
 * 顺序落地；任务内再判 paletteVisible，翻转语义不被排队时机扭曲。
 */
let paletteTransition: Promise<unknown> = Promise.resolve()
function enqueuePaletteTransition(task: () => Promise<void>): Promise<void> {
  const run = paletteTransition.then(task, task)
  paletteTransition = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 逻辑隐藏：先归还焦点再停回屏外。幂等——blur 事件与我们主动 blur() 会重入这里。 */
async function parkPalette(window: WindowHandle): Promise<void> {
  if (!paletteVisible) return
  paletteVisible = false
  await window.blur()
  await window.setPosition(PARKED_POSITION.x, PARKED_POSITION.y)
}

/**
 * 逻辑显示：纯位移唤出。最小化场景（如 Win+D 波及的 parked 窗）先挪到屏外
 * 再 restore——Windows 恢复动画播在不可见区，随后 setPosition 瞬移回目标位。
 */
async function showPalette(window: WindowHandle): Promise<void> {
  if (await window.isMinimized()) {
    await window.setPosition(PARKED_POSITION.x, PARKED_POSITION.y)
    await window.restore()
  }
  const position = await desiredPalettePosition()
  if (position) await window.setPosition(position.x, position.y)
  paletteVisible = true
  await window.focus()
  // 页面复位输入框并聚焦（页面侧 brickly.on('shown')）。
  await window.send('shown')
}

brick.onCommand('toggle', async () => {
  const window = await ensureWindow()
  // 入队串行翻转：任务落地时再判 paletteVisible——连打热键按序执行显隐，
  // 不会出现"队列里判一次、落地时状态已变"的错序。
  await enqueuePaletteTransition(async () => {
    if (paletteVisible) await parkPalette(window)
    // 新建窗停在屏外（创建路径见 createWindow），经 showPalette 位移唤出。
    else await showPalette(window)
  })
  return { visible: paletteVisible }
})

// 常驻实例启动即预热：在屏外完成建窗与唯一一次 OS 淡入，之后每次唤起都是
// 纯位移；预热失败不致命，toggle 内 ensureWindow 懒建兜底。
brick.onReady(() => {
  void ensureWindow().catch((error) => {
    brick.log.warn('浮窗预热失败，首次唤起时再建', {
      error: error instanceof Error ? error.message : error
    })
  })
})

brick.start()

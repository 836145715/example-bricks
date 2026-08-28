'use strict'

const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

const brick = new BricklyRuntime()

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BppError('CANCELLED', '已取消'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new BppError('CANCELLED', '已取消'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function bindLab(win, kind) {
  let ticks = 0
  const timer = setInterval(() => {
    ticks += 1
    void win.send('tick', { kind, ticks, at: Date.now() }).catch(() => {})
  }, 1000)

  win.on('closed', () => {
    clearInterval(timer)
  })

  win.expose({
    echo(payload) {
      brick.log.info('echo', { kind, payload })
      return { echo: payload, kind, at: Date.now() }
    },
    ping(payload) {
      brick.log.info('notify ping', { kind, payload })
      return { ignored: true }
    },
    async import(payload, { emit, signal }) {
      for (let step = 1; step <= 5; step += 1) {
        if (signal.aborted) throw new BppError('CANCELLED', 'import 已取消')
        await emit({ progress: step * 20, step, of: 5 })
        await sleep(400, signal)
      }
      return { imported: true, payload, kind }
    },
    hang(_payload, { signal }) {
      return new Promise((_resolve, reject) => {
        const fail = () => reject(new BppError('CANCELLED', 'hang 已取消'))
        if (signal.aborted) {
          fail()
          return
        }
        signal.addEventListener('abort', fail, { once: true })
      })
    }
  })

  void win.send('hello', { kind, windowId: win.id }).catch(() => {})
}

brick.onCommand('open-attached', async (ctx) => {
  const win = await ctx.ui.createBrowserWindow('ui/child.html', {
    width: 540,
    height: 760,
    title: '子窗 RPC · attached'
  })
  bindLab(win, 'attached')
  await new Promise((resolve) => {
    win.on('closed', resolve)
  })
  return { kind: 'attached', closed: true, windowId: win.id }
})

brick.onCommand('open-standalone', async (ctx) => {
  const win = await ctx.ui.createBrowserWindow('ui/child.html', {
    width: 540,
    height: 760,
    title: '子窗 RPC · standalone',
    lifetime: 'standalone'
  })
  bindLab(win, 'standalone')
  return { kind: 'standalone', windowId: win.id }
})

brick.start()

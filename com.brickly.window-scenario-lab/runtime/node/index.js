/* eslint-disable */
'use strict'

/**
 * 窗口场景测试台 —— 入口。
 *
 * 模块拆分：
 *   scenarios.js        场景预设
 *   win-session-store.js  WinSession Map / 索引
 *   notify.js           控制台/子窗推送 + ALS 排队
 *   bind-win-session.js 创建时绑定 handle 事件
 *   open-windows.js     开/关/focus/ping
 *   control-messages.js sendToParent 协议处理
 */

const { BricklyRuntime } = require('@syllm/brickly-sdk')
const { setNotifyPlugin } = require('./notify')
const { setBindDeps } = require('./bind-win-session')
const {
  setOpenWindowsPlugin,
  openControl,
  openScenario,
  openSuite,
  focusWinSession,
  closeWinSession,
  closeAll,
  pingWinSession,
  listWinSessions
} = require('./open-windows')
const { setControlMessagesPlugin, onWindowMessage } = require('./control-messages')

const plugin = new BricklyRuntime({ brickId: 'com.brickly.window-scenario-lab' })

setNotifyPlugin(plugin)
setOpenWindowsPlugin(plugin)
setControlMessagesPlugin(plugin)
setBindDeps({
  log: plugin.log,
  onWindowMessage
})

plugin.onCommand('open-control', async () => openControl())
plugin.onCommand('open-scenario', async (_ctx, input) => openScenario(input || {}))
plugin.onCommand('open-suite', async (_ctx, input) => openSuite(input || {}))
plugin.onCommand('list-win-sessions', async () => ({ winSessions: listWinSessions() }))
plugin.onCommand('focus-win-session', async (_ctx, input) =>
  focusWinSession(Number(input?.windowId))
)
plugin.onCommand('close-win-session', async (_ctx, input) =>
  closeWinSession(Number(input?.windowId))
)
plugin.onCommand('close-all', async (_ctx, input) => ({
  closed: await closeAll(input?.keepControl !== false)
}))
plugin.onCommand('ping-win-session', async (_ctx, input) =>
  pingWinSession(Number(input?.windowId), input?.text || 'hello')
)

plugin.onShutdown(async () => {
  await closeAll(false).catch(() => {})
})

plugin.start()

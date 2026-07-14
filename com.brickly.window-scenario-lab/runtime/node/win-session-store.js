'use strict'

/**
 * 窗口会话（WinSession）内存仓。
 * 一扇命令子窗 = 一条 WinSession；不是登录 session。
 */

/** @type {Map<number, import('./types').WinSession>} */
const winSessions = new Map()
/** scenarioId → windowId（ensure 复用） */
const scenarioIndex = new Map()
/** @type {number | null} */
let controlWindowId = null

function isAlive(handle) {
  return Boolean(handle && !handle.closed)
}

function getControlWindowId() {
  return controlWindowId
}

function setControlWindowId(id) {
  controlWindowId = id
}

function getWinSession(windowId) {
  return winSessions.get(windowId)
}

function setWinSession(windowId, winSession) {
  winSessions.set(windowId, winSession)
}

function deleteWinSession(windowId) {
  winSessions.delete(windowId)
}

function allWindowIds() {
  return [...winSessions.keys()]
}

function winSessionSummary(winSession) {
  return {
    windowId: winSession.handle.id,
    role: winSession.role,
    scenario: winSession.scenario || null,
    title: winSession.title,
    createdAt: winSession.createdAt,
    closed: Boolean(winSession.handle.closed),
    eventCount: winSession.events.length,
    lastEvents: winSession.events.slice(-8)
  }
}

function listWinSessions() {
  return [...winSessions.values()].map(winSessionSummary)
}

function getScenarioWindowId(scenario) {
  return scenarioIndex.get(scenario)
}

function setScenarioWindowId(scenario, windowId) {
  scenarioIndex.set(scenario, windowId)
}

function clearScenarioWindowId(scenario) {
  scenarioIndex.delete(scenario)
}

function getControlWinSession() {
  if (controlWindowId == null) return null
  return winSessions.get(controlWindowId) || null
}

module.exports = {
  isAlive,
  getControlWindowId,
  setControlWindowId,
  getWinSession,
  setWinSession,
  deleteWinSession,
  allWindowIds,
  winSessionSummary,
  listWinSessions,
  getScenarioWindowId,
  setScenarioWindowId,
  clearScenarioWindowId,
  getControlWinSession
}

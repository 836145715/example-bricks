'use strict'

const { createResult, sanitizeError } = require('./contracts.cjs')

class SkipScenario extends Error {
  constructor(reason) {
    super(reason)
    this.code = 'SKIPPED'
  }
}

class WaitingRestart extends Error {
  constructor(checkpoint) {
    super('waiting for restart')
    this.code = 'WAITING_RESTART'
    this.checkpoint = checkpoint
  }
}

class RunManager {
  constructor({ executeScenario, maxParallel = 3, onUpdate = () => undefined, now = () => Date.now() }) {
    this.executeScenario = executeScenario
    this.maxParallel = maxParallel
    this.onUpdate = onUpdate
    this.now = now
    this.runs = new Map()
    this.gate = new ScenarioGate(maxParallel)
  }

  start({ runId, scenarios, mode = 'selected', executeScenario }) {
    if (!runId || typeof runId !== 'string') throw invalidInput('runId')
    if (this.runs.has(runId)) throw invalidInput('runId already exists')
    if (!Array.isArray(scenarios) || scenarios.length === 0) throw invalidInput('scenarios')
    const run = {
      runId,
      mode,
      status: 'running',
      startedAt: this.now(),
      results: scenarios.map((scenario) => createResult(scenario, runId)),
      scenarios,
      executeScenario: executeScenario ?? this.executeScenario,
      abort: new AbortController(),
      cancelRequested: false
    }
    this.runs.set(runId, run)
    this.notify(run)
    run.promise = this.executeRun(run)
    return this.snapshot(run)
  }

  status(runId) {
    const run = this.runs.get(runId)
    if (!run) throw notFound(runId)
    return this.snapshot(run)
  }

  list() {
    return [...this.runs.values()].map((run) => this.snapshot(run))
  }

  wait(runId) {
    const run = this.runs.get(runId)
    if (!run) return Promise.reject(notFound(runId))
    return run.promise
  }

  async cancel(runId) {
    const run = this.runs.get(runId)
    if (!run) throw notFound(runId)
    if (isTerminal(run.status)) return this.snapshot(run)
    run.cancelRequested = true
    run.abort.abort()
    await run.promise
    return this.snapshot(run)
  }

  async cancelAll() {
    await Promise.all([...this.runs.values()].filter((run) => !isTerminal(run.status)).map((run) => this.cancel(run.runId)))
  }

  async executeRun(run) {
    const active = new Set()
    let index = 0
    const waitForOne = async () => {
      if (active.size > 0) await Promise.race(active)
    }
    const waitForAll = async () => {
      await Promise.all(active)
    }

    while (index < run.scenarios.length && !run.abort.signal.aborted) {
      const scenario = run.scenarios[index]
      if (scenario.exclusive) {
        await waitForAll()
        if (run.abort.signal.aborted) break
        await this.executeOne(run, scenario, index)
        index++
        continue
      }
      while (
        index < run.scenarios.length &&
        !run.scenarios[index].exclusive &&
        !run.abort.signal.aborted &&
        active.size < this.maxParallel
      ) {
        const currentIndex = index
        const operation = this.executeOne(run, run.scenarios[currentIndex], currentIndex)
        active.add(operation)
        operation.finally(() => active.delete(operation))
        index++
      }
      if (active.size > 0) await waitForOne()
    }
    await waitForAll()

    if (run.abort.signal.aborted) {
      for (const result of run.results) {
        if (result.status === 'pending') result.status = 'cancelled'
      }
      run.status = 'cancelled'
    } else if (run.results.some((result) => result.status === 'failed')) {
      run.status = 'failed'
    } else if (run.results.some((result) => result.status === 'waiting-restart')) {
      run.status = 'waiting-restart'
    } else {
      run.status = 'passed'
    }
    run.finishedAt = this.now()
    this.notify(run)
    return this.snapshot(run)
  }

  async executeOne(run, scenario, index) {
    const result = run.results[index]
    let release
    try {
      release = await this.gate.acquire(Boolean(scenario.exclusive), run.abort.signal)
      result.status = 'running'
      result.startedAt = this.now()
      this.notify(run)
      const details = await run.executeScenario(scenario, {
        runId: run.runId,
        signal: run.abort.signal
      })
      Object.assign(result, details)
      result.status = run.abort.signal.aborted ? 'cancelled' : 'passed'
    } catch (error) {
      if (error instanceof SkipScenario || error?.code === 'SKIPPED') {
        result.status = 'skipped'
        result.skipReason = error.message
      } else if (error instanceof WaitingRestart || error?.code === 'WAITING_RESTART') {
        result.status = 'waiting-restart'
        result.checkpoint = error.checkpoint
      } else if (run.abort.signal.aborted || error?.code === 'CANCELLED') {
        result.status = 'cancelled'
      } else {
        result.status = 'failed'
        result.error = sanitizeError(error)
      }
    } finally {
      result.finishedAt = this.now()
      result.durationMs = Math.max(0, result.finishedAt - (result.startedAt ?? result.finishedAt))
      if (result.sizeBytes > 0 && result.durationMs > 0) {
        result.throughputBytesPerSecond = Math.round(result.sizeBytes / (result.durationMs / 1000))
      }
      this.notify(run)
      release?.()
    }
  }

  notify(run) {
    const snapshot = this.snapshot(run)
    Promise.resolve(this.onUpdate(snapshot)).catch(() => undefined)
  }

  snapshot(run) {
    return JSON.parse(JSON.stringify({
      runId: run.runId,
      mode: run.mode,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      results: run.results
    }))
  }
}

class ScenarioGate {
  constructor(maxParallel) {
    this.maxParallel = maxParallel
    this.active = 0
    this.exclusive = false
    this.queue = []
  }

  acquire(exclusive, signal) {
    if (signal.aborted) return Promise.reject(cancelled())
    return new Promise((resolve, reject) => {
      const waiter = { exclusive, resolve, reject, signal, onAbort: undefined }
      waiter.onAbort = () => {
        const index = this.queue.indexOf(waiter)
        if (index >= 0) this.queue.splice(index, 1)
        reject(cancelled())
        this.drain()
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.queue.push(waiter)
      this.drain()
    })
  }

  drain() {
    if (this.exclusive || this.queue.length === 0) return
    const first = this.queue[0]
    if (first.exclusive) {
      if (this.active > 0) return
      this.start(this.queue.shift())
      return
    }
    while (this.active < this.maxParallel && this.queue.length > 0 && !this.queue[0].exclusive) {
      this.start(this.queue.shift())
    }
  }

  start(waiter) {
    waiter.signal.removeEventListener('abort', waiter.onAbort)
    this.active++
    this.exclusive = waiter.exclusive
    let released = false
    waiter.resolve(() => {
      if (released) return
      released = true
      this.active--
      if (waiter.exclusive) this.exclusive = false
      this.drain()
    })
  }
}

function isTerminal(status) {
  return ['passed', 'failed', 'cancelled', 'waiting-restart'].includes(status)
}

function invalidInput(message) {
  const error = new Error(message)
  error.code = 'INVALID_INPUT'
  return error
}

function notFound(runId) {
  const error = new Error(`run not found: ${runId}`)
  error.code = 'NOT_FOUND'
  return error
}

function cancelled() {
  const error = new Error('cancelled')
  error.code = 'CANCELLED'
  return error
}

module.exports = { RunManager, SkipScenario, WaitingRestart }

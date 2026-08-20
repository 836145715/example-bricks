'use strict'

class HoldRegistry {
  constructor() {
    this.controllers = new Map()
  }

  begin(operationId) {
    if (typeof operationId !== 'string' || !operationId) throw invalidInput('operationId')
    if (this.controllers.has(operationId)) throw invalidInput('operationId already active')
    const controller = new AbortController()
    this.controllers.set(operationId, controller)
    return controller.signal
  }

  cancel(operationId) {
    const controller = this.controllers.get(operationId)
    if (!controller) return false
    controller.abort()
    return true
  }

  end(operationId) {
    this.controllers.delete(operationId)
  }
}

function invalidInput(message) {
  const error = new Error(message)
  error.code = 'INVALID_INPUT'
  return error
}

module.exports = { HoldRegistry }

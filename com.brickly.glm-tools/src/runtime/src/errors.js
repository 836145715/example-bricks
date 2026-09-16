/* eslint-disable */
'use strict'

const { BppError } = require('@syllm/brickly-sdk')

function makeError(code, message, details) {
  return new BppError(code, message, details)
}

function isBppError(error) {
  return error && typeof error.code === 'string' && typeof error.message === 'string'
}

function normalizeError(error) {
  if (isBppError(error)) return error
  if (error && error.name === 'AbortError') {
    return makeError('CANCELLED', '请求已取消')
  }
  if (error instanceof Error) {
    return makeError(error.code || 'INTERNAL_ERROR', error.message)
  }
  return makeError('INTERNAL_ERROR', String(error))
}

module.exports = {
  makeError,
  normalizeError
}

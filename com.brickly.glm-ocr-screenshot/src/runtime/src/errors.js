/* eslint-disable */
'use strict'

const { BppError } = require('@syllm/brickly-sdk')

function makeError(code, message, details) {
  return new BppError(code, message, details)
}

function normalizeError(error) {
  if (error && typeof error.code === 'string' && typeof error.message === 'string') return error
  if (error instanceof Error) return makeError(error.code || 'INTERNAL_ERROR', error.message)
  return makeError('INTERNAL_ERROR', String(error))
}

module.exports = {
  makeError,
  normalizeError
}

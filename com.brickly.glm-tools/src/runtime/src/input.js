/* eslint-disable */
'use strict'

const { makeError } = require('./errors')

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function requiredString(value, fieldName) {
  const text = optionalString(value)
  if (!text) throw makeError('INVALID_INPUT', `${fieldName} 不能为空`)
  return text
}

function numberOrDefault(value, defaultValue, fieldName, options = {}) {
  if (value === undefined || value === null || value === '') return defaultValue
  const n = Number(value)
  if (!Number.isFinite(n)) throw makeError('INVALID_INPUT', `${fieldName} 必须是数字`)
  if (options.min !== undefined && n < options.min) {
    throw makeError('INVALID_INPUT', `${fieldName} 不能小于 ${options.min}`)
  }
  if (options.max !== undefined && n > options.max) {
    throw makeError('INVALID_INPUT', `${fieldName} 不能大于 ${options.max}`)
  }
  return n
}

function booleanOrDefault(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return Boolean(value)
}

function enumOrDefault(value, defaultValue, allowed, fieldName) {
  const text = optionalString(value) || defaultValue
  if (!allowed.includes(text)) {
    throw makeError('INVALID_INPUT', `${fieldName} 只能是: ${allowed.join(', ')}`)
  }
  return text
}

function parseJsonInput(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch (error) {
      throw makeError('INVALID_INPUT', `${fieldName} 必须是合法 JSON: ${error.message}`)
    }
  }
  return value
}

function assignIfPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== '') target[key] = value
  return target
}

module.exports = {
  optionalString,
  requiredString,
  numberOrDefault,
  booleanOrDefault,
  enumOrDefault,
  parseJsonInput,
  assignIfPresent
}

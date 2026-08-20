/* eslint-disable */
'use strict'

const path = require('path')
const os = require('os')
const { makeError } = require('./errors')

const OCR_LANGUAGE_TYPES = [
  'CHN_ENG',
  'AUTO',
  'ENG',
  'JAP',
  'KOR',
  'FRE',
  'SPA',
  'POR',
  'GER',
  'ITA',
  'RUS',
  'DAN',
  'DUT',
  'MAL',
  'SWE',
  'IND',
  'POL',
  'ROM',
  'TUR',
  'GRE',
  'HUN',
  'THA',
  'VIE',
  'ARA',
  'HIN'
]

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function booleanOrDefault(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return Boolean(value)
}

function enumOrDefault(value, defaultValue, allowed, fieldName) {
  const text = optionalString(value) || defaultValue
  if (!allowed.includes(text)) {
    throw makeError('INVALID_INPUT', `${fieldName} 只能是: ${allowed.join(', ')}`)
  }
  return text
}

function resolveOutputDir(input = {}) {
  const raw = optionalString(input.outputDir)
  return raw || path.join(os.tmpdir(), 'brickly-glm-ocr-screenshot')
}

function normalizeCaptureInput(input = {}) {
  return {
    languageType: enumOrDefault(input.languageType, 'AUTO', OCR_LANGUAGE_TYPES, 'languageType'),
    probability: booleanOrDefault(input.probability, false),
    outputDir: resolveOutputDir(input),
    keepScreenshot: booleanOrDefault(input.keepScreenshot, false)
  }
}

module.exports = {
  normalizeCaptureInput,
  OCR_LANGUAGE_TYPES
}

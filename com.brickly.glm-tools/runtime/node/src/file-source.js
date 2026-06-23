/* eslint-disable */
'use strict'

const fs = require('fs/promises')
const path = require('path')
const { makeError } = require('./errors')
const { optionalString } = require('./input')

const MIME_BY_EXT = {
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function isProvided(value) {
  return value !== undefined && value !== null && value !== ''
}

function parseDataUrl(dataUrl, fieldName) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw makeError('INVALID_INPUT', `${fieldName} 不是合法 data URL`)
  const mimeType = match[1] || 'application/octet-stream'
  const body = match[3] || ''
  const buffer = match[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body))
  return { buffer, mimeType }
}

function inferMimeType(filename, fallback) {
  if (fallback) return fallback
  const ext = path.extname(filename || '').toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

async function readPathFile(filePath, explicitName, explicitType) {
  const absolutePath = optionalString(filePath)
  if (!absolutePath) throw makeError('INVALID_INPUT', '文件路径不能为空')
  const buffer = await fs.readFile(absolutePath)
  const name = explicitName || path.basename(absolutePath)
  return {
    buffer,
    name,
    mimeType: inferMimeType(name, explicitType),
    size: buffer.length,
    source: 'path',
    path: absolutePath
  }
}

async function readFileObject(value, fieldName) {
  if (typeof value === 'string') {
    return readPathFile(value)
  }

  if (!value || typeof value !== 'object') {
    throw makeError('INVALID_INPUT', `${fieldName} 必须是文件对象`)
  }

  if (typeof value.dataUrl === 'string') {
    const parsed = parseDataUrl(value.dataUrl, fieldName)
    const name = optionalString(value.name) || 'upload'
    return {
      buffer: parsed.buffer,
      name,
      mimeType: inferMimeType(name, optionalString(value.type) || parsed.mimeType),
      size: parsed.buffer.length,
      source: 'dataUrl'
    }
  }

  const filePath = optionalString(value.path) || optionalString(value.$file)
  if (filePath) {
    return readPathFile(filePath, optionalString(value.name), optionalString(value.type))
  }

  throw makeError('INVALID_INPUT', `${fieldName} 无法识别的文件对象`)
}

async function resolveUploadFile(input, options) {
  const fileField = options.fileField
  const pathField = options.pathField
  const label = options.label || fileField
  const fileValue = input ? input[fileField] : undefined
  const pathValue = input ? input[pathField] : undefined
  const hasFile = isProvided(fileValue)
  const hasPath = isProvided(pathValue)

  if (hasFile && hasPath) {
    throw makeError('INVALID_INPUT', `${fileField} 与 ${pathField} 只能提供一个`)
  }
  if (!hasFile && !hasPath) {
    throw makeError('INVALID_INPUT', `请提供 ${label}`)
  }

  if (hasPath) return readPathFile(pathValue)
  return readFileObject(fileValue, fileField)
}

module.exports = {
  resolveUploadFile,
  parseDataUrl,
  inferMimeType
}

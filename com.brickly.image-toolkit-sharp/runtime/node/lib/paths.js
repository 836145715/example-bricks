'use strict'

const path = require('node:path')

/**
 * Sanitize a basename segment used in output filenames.
 * Strips path separators and rejects `..` / empty / unsafe characters.
 * @param {string} segment
 * @param {string} label
 * @returns {string}
 */
function sanitizeBasenameSegment (segment, label = 'segment') {
  if (segment == null || typeof segment !== 'string') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  // Strip path separators and normalize
  let s = segment.replace(/[/\\]/g, '')
  if (!s || s.includes('..') || s === '.' || s === '..') {
    throw new Error(`Invalid ${label}: path traversal or empty segment is not allowed`)
  }
  // Only allow safe identifier-like characters: start with letter, then alnum
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(s)) {
    throw new Error(`Invalid ${label}: must match [a-zA-Z][a-zA-Z0-9]*`)
  }
  return s
}

/**
 * Sanitize and whitelist an image format extension (no leading dot).
 * Strips leading dots, lowercases; only [a-z0-9]+ is allowed (rejects ../, separators, etc.).
 * @param {string} format
 * @returns {string} lowercase format without leading dots
 */
function sanitizeFormat (format) {
  if (format == null || typeof format !== 'string') {
    throw new TypeError('format must be a non-empty string')
  }
  // Drop leading dots only (do not strip separators — those must fail the whitelist)
  const s = format.replace(/^\.+/, '').toLowerCase()
  if (!s || !/^[a-z0-9]+$/.test(s)) {
    throw new Error(`Invalid format: only [a-z0-9]+ allowed after normalization, got ${JSON.stringify(format)}`)
  }
  return s
}

/**
 * Resolve the output path for an image toolkit action.
 * Conflict-increment naming is left to a later task.
 *
 * @param {{ inputPath: string, action: string, options?: object, output?: { mode?: string, dir?: string } }} params
 * @returns {string}
 */
function resolveOutputPath ({ inputPath, action, options = {}, output = {} }) {
  const mode = output.mode || 'sidecar'
  const parsed = path.parse(inputPath)

  const safeAction = sanitizeBasenameSegment(action, 'action')

  let ext
  if (safeAction === 'pdf') {
    ext = '.pdf'
  } else if (safeAction === 'gif') {
    ext = '.gif'
  } else if (safeAction === 'convert' && options.format) {
    ext = `.${sanitizeFormat(options.format)}`
  } else {
    ext = parsed.ext
  }

  const fileName = `${parsed.name}_${safeAction}_processed${ext}`

  if (mode === 'dir') {
    if (output.dir == null || output.dir === '') {
      throw new TypeError('output.dir is required when output.mode is "dir"')
    }
    return path.join(output.dir, fileName)
  }

  // default: sidecar — same directory as input
  return path.join(parsed.dir, fileName)
}

module.exports = { resolveOutputPath, sanitizeBasenameSegment, sanitizeFormat }

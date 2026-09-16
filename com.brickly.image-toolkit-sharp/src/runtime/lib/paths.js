'use strict'

const fs = require('node:fs/promises')
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
 * Conflict-increment naming is handled by ensureUniquePath.
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
  } else if (
    (safeAction === 'convert' || safeAction === 'compress') &&
    options.format
  ) {
    // compress may switch PNG→JPEG/WebP; ext must follow encoded format
    const fmt = sanitizeFormat(options.format)
    ext = `.${fmt === 'jpeg' ? 'jpg' : fmt}`
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

/**
 * If overwrite is falsy and filePath exists, return `name (1).ext`, `name (2).ext`, ...
 * If overwrite is truthy (or path free), return filePath unchanged.
 *
 * @param {string} filePath
 * @param {boolean} [overwrite=false]
 * @returns {Promise<string>}
 */
async function ensureUniquePath (filePath, overwrite = false) {
  if (overwrite) return filePath

  try {
    await fs.access(filePath)
  } catch {
    // does not exist — free to use
    return filePath
  }

  const parsed = path.parse(filePath)
  let i = 1
  for (;;) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${i})${parsed.ext}`)
    try {
      await fs.access(candidate)
      i += 1
    } catch {
      return candidate
    }
  }
}

module.exports = {
  resolveOutputPath,
  ensureUniquePath,
  sanitizeBasenameSegment,
  sanitizeFormat
}

'use strict'

const path = require('node:path')

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

  let ext
  if (action === 'pdf') {
    ext = '.pdf'
  } else if (action === 'gif') {
    ext = '.gif'
  } else if (action === 'convert' && options.format) {
    ext = `.${options.format}`
  } else {
    ext = parsed.ext
  }

  const fileName = `${parsed.name}_${action}_processed${ext}`

  if (mode === 'dir') {
    return path.join(output.dir, fileName)
  }

  // default: sidecar — same directory as input
  return path.join(parsed.dir, fileName)
}

module.exports = { resolveOutputPath }

'use strict'

/**
 * Action registry for image-toolkit-sharp.
 *
 * ## Result convention (stable for task4 batch)
 *
 * Every action `run(ctx)` MUST resolve to exactly one of:
 *
 * | type        | fields                         | meaning |
 * |-------------|--------------------------------|---------|
 * | `pipeline`  | `{ type, pipeline }`           | Sharp pipeline ready for `toFile` / `writeAndStat` |
 * | `buffer`    | `{ type, buffer, format? }`    | Encoded bytes; caller writes to `outputPath` |
 * | `written`   | `{ type, outputPath }`         | Action already wrote the file (e.g. pdf) |
 *
 * ## ctx shape
 *
 * ```js
 * {
 *   inputPath: string,              // primary / per-file input
 *   files?: string[],               // multi-file list (join/pdf/gif)
 *   options: object,
 *   outputPath?: string,            // required when action may self-write
 *   loadSharp: () => sharp,
 *   escapeXml?: (s: string) => string,           // watermark
 *   compileJpegsToPdf?: (bufs, path) => Promise, // pdf
 *   ensureNotCancelled?: () => void,
 * }
 * ```
 *
 * ## mode
 *
 * - `per-file`: operates on `ctx.inputPath` (one image)
 * - `multi`: operates on `ctx.files` (join / pdf / gif)
 */

const compress = require('./compress')
const convert = require('./convert')
const resize = require('./resize')
const watermark = require('./watermark')
const roundedCorners = require('./rounded-corners')
const padding = require('./padding')
const crop = require('./crop')
const rotate = require('./rotate')
const flip = require('./flip')
const stripMeta = require('./strip-meta')
const join = require('./join')
const pdf = require('./pdf')
const gif = require('./gif')

/** @type {Record<string, { id: string, mode: 'per-file'|'multi', run: Function }>} */
const ACTION_MAP = {
  compress,
  convert,
  resize,
  watermark,
  roundedCorners,
  padding,
  crop,
  // legacy alias used by older clients
  manualCrop: crop,
  rotate,
  flip,
  stripMeta,
  join,
  pdf,
  gif
}

/**
 * @param {string} id
 * @returns {{ id: string, mode: 'per-file'|'multi', run: Function } | undefined}
 */
function getAction (id) {
  return ACTION_MAP[id]
}

/**
 * @returns {string[]}
 */
function listActionIds () {
  // unique ids (manualCrop aliases crop)
  return [
    'compress',
    'convert',
    'resize',
    'watermark',
    'roundedCorners',
    'padding',
    'crop',
    'rotate',
    'flip',
    'stripMeta',
    'join',
    'pdf',
    'gif'
  ]
}

module.exports = {
  ACTION_MAP,
  getAction,
  listActionIds
}

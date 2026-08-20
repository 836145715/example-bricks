'use strict'

let _sharp = null
let _configured = false

/**
 * Configure sharp for desktop tooling on Windows.
 * libvips file cache keeps source/output paths open and blocks delete/rename.
 * @param {typeof import('sharp')} sharp
 */
function configureSharp (sharp) {
  if (_configured) return
  _configured = true
  try {
    // Disable memory + file + item caches (critical on Windows file locking)
    sharp.cache(false)
  } catch (_) {
    /* older sharp */
  }
  try {
    // Avoid retaining decoded images longer than needed
    sharp.cache({ memory: 0, files: 0, items: 0 })
  } catch (_) {
    /* ignore if cache(false) already applied */
  }
}

function loadSharp () {
  if (_sharp) return _sharp
  try {
    _sharp = require('sharp')
    configureSharp(_sharp)
    return _sharp
  } catch (e) {
    const err = new Error('sharp 模块加载失败：' + e.message)
    err.code = 'NATIVE_DEP_MISSING'
    throw err
  }
}

/**
 * Drop any residual libvips caches after a job (safe to call often).
 */
function releaseSharpResources () {
  try {
    const sharp = loadSharp()
    sharp.cache(false)
    sharp.cache({ memory: 0, files: 0, items: 0 })
  } catch (_) {
    /* sharp may be missing in tests */
  }
}

module.exports = { loadSharp, releaseSharpResources }

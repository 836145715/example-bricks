'use strict'

let _sharp = null

function loadSharp () {
  if (_sharp) return _sharp
  try {
    _sharp = require('sharp')
    return _sharp
  } catch (e) {
    const err = new Error('sharp 模块加载失败：' + e.message)
    err.code = 'NATIVE_DEP_MISSING'
    throw err
  }
}

module.exports = { loadSharp }

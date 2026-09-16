'use strict'

function createProgress (onProgress) {
  return (p, message) => {
    if (typeof onProgress === 'function') onProgress(p, message)
  }
}

module.exports = { createProgress }

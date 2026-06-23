/* eslint-disable */
'use strict'

const { execFile } = require('node:child_process')
const { BppError } = require('@syllm/brickly-sdk')

const DEFAULT_TIMEOUT_MS = 12000
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024

function runFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer || DEFAULT_MAX_BUFFER,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: 0 })
          return
        }
        const code =
          error.killed && error.signal === 'SIGTERM'
            ? 'COMMAND_TIMEOUT'
            : typeof error.code === 'number'
              ? `EXIT_${error.code}`
              : 'COMMAND_FAILED'
        reject(
          new BppError(code, `${file} ${args.join(' ')} failed: ${error.message}`, {
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: typeof error.code === 'number' ? error.code : null
          })
        )
      }
    )
  })
}

module.exports = {
  runFile
}

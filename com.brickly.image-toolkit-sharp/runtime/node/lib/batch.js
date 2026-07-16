'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { getAction } = require('../actions')
const { resolveOutputPath, ensureUniquePath } = require('./paths')
const { applyStripMetadata, writeAndStat } = require('./pipeline')
const { createProgress } = require('./progress')
const { loadSharp } = require('./sharp-loader')
const { escapeXml } = require('./svg-escape')
const { compileJpegsToPdf } = require('./pdf-compile')

/**
 * Wrap sharp so string file paths get EXIF auto-orient (rotate) when enabled.
 * Buffer / create inputs are left unchanged.
 * @param {boolean} autoOrient
 * @returns {() => function}
 */
function createLoadSharp (autoOrient) {
  if (!autoOrient) return loadSharp
  return () => {
    const sharp = loadSharp()
    return function sharpWithOrient (input, opts) {
      const inst = sharp(input, opts)
      if (typeof input === 'string') {
        return inst.rotate()
      }
      return inst
    }
  }
}

/**
 * @param {unknown} err
 * @returns {{ code: string, message: string }}
 */
function errorPayload (err) {
  const code =
    err && typeof err === 'object' && err.code != null
      ? String(err.code)
      : 'PROCESS_ERROR'
  const message =
    err && typeof err === 'object' && err.message
      ? String(err.message)
      : String(err)
  return { code, message }
}

/**
 * @param {string} input
 * @param {unknown} err
 */
function failItem (input, err) {
  return { input, ok: false, error: errorPayload(err) }
}

/**
 * @param {string} input
 * @param {{ outputPath: string, sizeBytes: number, sizeKb: number, width: number|null, height: number|null, format: string|null }} stats
 */
function okItem (input, stats) {
  return {
    input,
    ok: true,
    outputPath: stats.outputPath,
    sizeBytes: stats.sizeBytes,
    sizeKb: stats.sizeKb,
    width: stats.width,
    height: stats.height,
    format: stats.format
  }
}

/**
 * @param {string} outPath
 * @returns {Promise<{ outputPath: string, sizeBytes: number, sizeKb: number, width: number|null, height: number|null, format: string|null }>}
 */
async function statExisting (outPath) {
  const sharp = loadSharp()
  const finalStat = await fs.stat(outPath)
  const finalMeta = await sharp(outPath).metadata().catch(() => ({}))
  return {
    outputPath: outPath,
    sizeBytes: finalStat.size,
    sizeKb: Math.round((finalStat.size / 1024) * 100) / 100,
    width: finalMeta.width || null,
    height: finalMeta.height || null,
    format: finalMeta.format || null
  }
}

/**
 * Apply action result: stripMetadata (when applicable) → write → stat.
 * written results skip strip (already on disk).
 *
 * @param {{ type: string, pipeline?: import('sharp').Sharp, buffer?: Buffer, outputPath?: string, format?: string }} actionResult
 * @param {string} outputPath
 * @param {boolean} stripMetadata
 */
async function materializeResult (actionResult, outputPath, stripMetadata) {
  if (!actionResult || !actionResult.type) {
    throw Object.assign(new Error('Action returned invalid result'), {
      code: 'INVALID_ACTION_RESULT'
    })
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  if (actionResult.type === 'pipeline') {
    let pipeline = actionResult.pipeline
    pipeline = applyStripMetadata(pipeline, stripMetadata)
    return writeAndStat(pipeline, outputPath)
  }

  if (actionResult.type === 'buffer') {
    let buffer = actionResult.buffer
    // Buffer is already encoded; re-encode only when caller asked to strip metadata.
    if (stripMetadata && Buffer.isBuffer(buffer)) {
      const sharp = loadSharp()
      // Default re-encode drops most metadata (no withMetadata).
      buffer = await sharp(buffer).toBuffer()
    }
    await fs.writeFile(outputPath, buffer)
    return statExisting(outputPath)
  }

  if (actionResult.type === 'written') {
    // Already on disk (e.g. pdf) — strip not applicable.
    const writtenPath = actionResult.outputPath || outputPath
    return statExisting(writtenPath)
  }

  throw Object.assign(
    new Error(`Action returned unknown type: ${actionResult.type}`),
    { code: 'INVALID_ACTION_RESULT' }
  )
}

/**
 * @param {() => boolean|undefined} isCancelled
 */
function ensureNotCancelled (isCancelled) {
  if (typeof isCancelled === 'function' && isCancelled()) {
    const err = new Error('Cancelled by host')
    err.code = 'CANCELLED'
    throw err
  }
}

/**
 * Batch / multi dispatcher for process-image.
 *
 * @param {object} params
 * @param {string} params.action
 * @param {string[]} params.files
 * @param {object} [params.options]
 * @param {{ mode?: 'sidecar'|'dir', dir?: string, overwrite?: boolean }} [params.output]
 * @param {{ autoOrient?: boolean, stripMetadata?: boolean }} [params.common]
 * @param {(p: number, message?: string) => void} [params.onProgress]
 * @param {() => boolean} [params.isCancelled]
 * @returns {Promise<{ items: object[], summary: { total: number, succeeded: number, failed: number } }>}
 */
async function runProcessImage ({
  action,
  files,
  options = {},
  output = {},
  common = {},
  onProgress,
  isCancelled
}) {
  if (!action || typeof action !== 'string') {
    throw Object.assign(new Error('action 必填'), { code: 'INVALID_INPUT' })
  }
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw Object.assign(new Error('files 数组不能为空'), { code: 'INVALID_INPUT' })
  }

  const actionMod = getAction(action)
  if (!actionMod) {
    throw Object.assign(new Error(`不支持的操作: ${action}`), {
      code: 'INVALID_ACTION'
    })
  }

  const autoOrient = common.autoOrient !== false // default true
  const stripMetadata =
    actionMod.id === 'stripMeta' || !!common.stripMetadata // default false; stripMeta forces on
  const overwrite = !!output.overwrite
  const report = createProgress(onProgress)
  const loadSharpFn = createLoadSharp(autoOrient)
  const checkCancel = () => ensureNotCancelled(isCancelled)

  /** @type {object[]} */
  const items = []

  /**
   * Shared action ctx factory.
   * @param {string} inputPath
   * @param {string} outputPath
   */
  function buildCtx (inputPath, outputPath) {
    return {
      inputPath,
      files,
      options,
      outputPath,
      loadSharp: loadSharpFn,
      escapeXml,
      compileJpegsToPdf,
      ensureNotCancelled: checkCancel,
      autoOrient,
      stripMetadata
    }
  }

  if (actionMod.mode === 'multi') {
    const inputLabel = files.join(',')
    checkCancel()
    report(0.1, `执行 ${actionMod.id}`)
    try {
      const baseOut = resolveOutputPath({
        inputPath: files[0],
        action: actionMod.id,
        options,
        output
      })
      const outputPath = await ensureUniquePath(baseOut, overwrite)
      checkCancel()
      report(0.4, `处理 ${files.length} 个文件`)

      const actionResult = await actionMod.run(buildCtx(files[0], outputPath))
      checkCancel()
      report(0.85, '写出结果')

      const stats = await materializeResult(actionResult, outputPath, stripMetadata)
      items.push(okItem(inputLabel, stats))
      report(1, '完成')
    } catch (err) {
      if (err && err.code === 'CANCELLED') throw err
      items.push(failItem(inputLabel, err))
      report(1, '失败')
    }
  } else {
    // per-file: independent try/catch per input
    const n = files.length
    for (let i = 0; i < n; i++) {
      const inputPath = files[i]
      checkCancel()
      report((i + 0.5) / n, `处理 ${i + 1}/${n}`)
      try {
        await fs.access(inputPath)
        const baseOut = resolveOutputPath({
          inputPath,
          action: actionMod.id,
          options,
          output
        })
        const outputPath = await ensureUniquePath(baseOut, overwrite)
        checkCancel()

        const actionResult = await actionMod.run(buildCtx(inputPath, outputPath))
        checkCancel()

        const stats = await materializeResult(
          actionResult,
          outputPath,
          stripMetadata
        )
        items.push(okItem(inputPath, stats))
      } catch (err) {
        if (err && err.code === 'CANCELLED') throw err
        items.push(failItem(inputPath, err))
      }
    }
    report(1, '完成')
  }

  let succeeded = 0
  let failed = 0
  for (const it of items) {
    if (it.ok) succeeded += 1
    else failed += 1
  }

  return {
    items,
    summary: {
      total: items.length,
      succeeded,
      failed
    }
  }
}

module.exports = { runProcessImage }

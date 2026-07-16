'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { getAction } = require('../actions')
const { resolveOutputPath, ensureUniquePath } = require('./paths')
const {
  applyStripMetadata,
  writeAndStat,
  statOnDisk,
  readFileBuffer,
  makePreviewDataUrl
} = require('./pipeline')
const { createProgress } = require('./progress')
const { loadSharp, releaseSharpResources } = require('./sharp-loader')
const { escapeXml } = require('./svg-escape')
const { compileJpegsToPdf } = require('./pdf-compile')

/**
 * Wrap sharp so:
 * - string paths are NOT passed to libvips (Windows handle leak).
 *   Callers should pass Buffer; if a string slips through we still open via
 *   a sync-incompatible path only for create{} objects / buffers.
 * - autoOrient applies .rotate() for Buffer/file-less pipelines.
 *
 * Prefer reading with readFileBuffer before sharp() in actions.
 *
 * @param {boolean} autoOrient
 * @returns {() => function}
 */
function createLoadSharp (autoOrient) {
  return () => {
    const sharp = loadSharp()
    return function sharpWithOrient (input, opts) {
      // Never pass filesystem paths into sharp on Windows — locks files.
      // Actions must use Buffer; defensive: if string, throw clear error.
      if (typeof input === 'string') {
        const err = new Error(
          'sharp(path) is disabled to avoid Windows file locks; pass a Buffer'
        )
        err.code = 'SHARP_PATH_FORBIDDEN'
        throw err
      }
      const inst = sharp(input, opts)
      if (autoOrient && Buffer.isBuffer(input)) {
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
function okItem (input, stats, inputSizeBytes) {
  return {
    input,
    ok: true,
    outputPath: stats.outputPath || undefined,
    sizeBytes: stats.sizeBytes,
    sizeKb: stats.sizeKb,
    inputSizeBytes: typeof inputSizeBytes === 'number' ? inputSizeBytes : undefined,
    inputSizeKb:
      typeof inputSizeBytes === 'number'
        ? Math.round((inputSizeBytes / 1024) * 100) / 100
        : undefined,
    width: stats.width,
    height: stats.height,
    format: stats.format,
    // optional UI preview (data URL), may be absent for pdf / failures
    previewDataUrl: stats.previewDataUrl || null,
    previewOnly: !!stats.previewOnly
  }
}

async function fileSizeBytes (filePath) {
  try {
    const st = await fs.stat(filePath)
    return st.size
  } catch {
    return undefined
  }
}

/**
 * Attach a UI data-URL preview for image outputs (not pdf).
 * @param {object} stats
 * @param {Buffer | null} [encodedBuffer]
 * @param {boolean} [wantPreview]
 * @param {boolean} [previewOnly]
 * @param {{ previewBuffer?: Buffer, previewFormat?: string }} [actionExtra]
 */
async function withPreview (
  stats,
  encodedBuffer,
  wantPreview,
  previewOnly = false,
  actionExtra = {}
) {
  if (!wantPreview || !stats) return stats
  // GIF: always use real animated buffer so UI can play it
  // Other formats: optional still previewBuffer override
  const isGif = String(stats.format || '').toLowerCase() === 'gif'
  const source = isGif
    ? encodedBuffer || (stats.outputPath ? stats.outputPath : null)
    : actionExtra.previewBuffer ||
      encodedBuffer ||
      (stats.outputPath ? stats.outputPath : null)
  if (!source) return stats
  const fmt = isGif
    ? 'gif'
    : actionExtra.previewFormat || stats.format
  const previewDataUrl = await makePreviewDataUrl(source, fmt, {
    faithful: true,
    maxBytes: isGif ? 5 * 1024 * 1024 : undefined
  })
  if (!previewDataUrl) return stats
  return { ...stats, previewDataUrl }
}

/**
 * @param {string} outPath
 * @returns {Promise<{ outputPath: string, sizeBytes: number, sizeKb: number, width: number|null, height: number|null, format: string|null }>}
 */
async function statExisting (outPath) {
  // Do not sharp(outPath) — that re-locks the file on Windows.
  return statOnDisk(outPath)
}

/**
 * Apply action result: stripMetadata (when applicable) → write → stat.
 * previewOnly: encode in memory only, never touch the filesystem for output.
 *
 * @param {{ type: string, pipeline?: import('sharp').Sharp, buffer?: Buffer, outputPath?: string, format?: string }} actionResult
 * @param {string} outputPath
 * @param {boolean} stripMetadata
 * @param {{ wantPreview?: boolean, previewOnly?: boolean }} [opts]
 */
async function materializeResult (actionResult, outputPath, stripMetadata, opts = {}) {
  const wantPreview = opts.wantPreview !== false
  const previewOnly = !!opts.previewOnly
  if (!actionResult || !actionResult.type) {
    throw Object.assign(new Error('Action returned invalid result'), {
      code: 'INVALID_ACTION_RESULT'
    })
  }

  if (!previewOnly) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
  }

  if (actionResult.type === 'pipeline') {
    let pipeline = actionResult.pipeline
    // withMetadata can break animated gif / synthetic canvases
    const fmtHint = actionResult.format
    if (fmtHint !== 'gif') {
      pipeline = applyStripMetadata(pipeline, stripMetadata)
    }
    const encoded = await pipeline.toBuffer({ resolveWithObject: true })
    const buffer = encoded.data
    const info = encoded.info || {}
    if (!previewOnly) {
      await fs.writeFile(outputPath, buffer)
    }
    const sizeBytes = buffer.length
    const stats = {
      outputPath: previewOnly ? '' : outputPath,
      sizeBytes,
      sizeKb: Math.round((sizeBytes / 1024) * 100) / 100,
      width: info.width != null ? info.width : null,
      height: info.height != null ? info.height : null,
      format: info.format || actionResult.format || null,
      previewOnly
    }
    return withPreview(stats, buffer, wantPreview || previewOnly, previewOnly, actionResult)
  }

  if (actionResult.type === 'buffer') {
    let buffer = actionResult.buffer
    // Do not re-encode GIF (would flatten animation into still strip)
    if (
      stripMetadata &&
      Buffer.isBuffer(buffer) &&
      actionResult.format !== 'gif'
    ) {
      const sharp = loadSharp()
      buffer = await sharp(buffer).toBuffer()
    }
    if (!previewOnly) {
      await fs.writeFile(outputPath, buffer)
    }
    const sizeBytes = buffer.length
    let width = null
    let height = null
    try {
      const meta = await loadSharp()(buffer, {
        animated: actionResult.format === 'gif',
        pages: actionResult.format === 'gif' ? -1 : undefined
      }).metadata()
      width = meta.width || null
      // For animated gif report frame size not stack height
      height =
        actionResult.format === 'gif' && meta.pageHeight
          ? meta.pageHeight
          : meta.height || null
    } catch (_) {
      /* ignore */
    }
    const stats = {
      outputPath: previewOnly ? '' : outputPath,
      sizeBytes,
      sizeKb: Math.round((sizeBytes / 1024) * 100) / 100,
      width,
      height,
      format: actionResult.format || null,
      previewOnly
    }
    return withPreview(
      stats,
      buffer,
      wantPreview || previewOnly,
      previewOnly,
      actionResult
    )
  }

  if (actionResult.type === 'written') {
    if (previewOnly) {
      throw Object.assign(
        new Error('PDF 等写入型操作不支持纯内存预览，请使用「处理」保存'),
        { code: 'PREVIEW_UNSUPPORTED' }
      )
    }
    // Already on disk (e.g. pdf) — strip not applicable; no image preview.
    const writtenPath = actionResult.outputPath || outputPath
    const stats = await statExisting(writtenPath)
    return withPreview(stats, null, false)
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
 * @param {boolean} [params.previewOnly] - in-memory only; never write output files
 * @param {(p: number, message?: string) => void} [params.onProgress]
 * @param {() => boolean} [params.isCancelled]
 * @returns {Promise<{ items: object[], summary: { total: number, succeeded: number, failed: number, previewOnly?: boolean } }>}
 */
async function runProcessImage ({
  action,
  files,
  options = {},
  output = {},
  common = {},
  previewOnly = false,
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
  // Cap previews to keep BPP payload small on large batches
  let previewBudget = previewOnly ? 4 : 8
  // In-memory preview: only first file for per-file actions (fast param tuning)
  const perFileList =
    previewOnly && actionMod.mode === 'per-file' ? files.slice(0, 1) : files

  if (previewOnly && actionMod.id === 'pdf') {
    throw Object.assign(
      new Error('合并 PDF 不支持纯内存预览，请使用「处理」保存'),
      { code: 'PREVIEW_UNSUPPORTED' }
    )
  }

  /**
   * Shared action ctx factory.
   * @param {string} inputPath
   * @param {string} outputPath
   */
  function buildCtx (inputPath, outputPath) {
    return {
      inputPath,
      // multi actions always need full files list; per-file preview uses slice via perFileList loop
      files,
      options,
      outputPath: previewOnly ? '' : outputPath,
      loadSharp: loadSharpFn,
      escapeXml,
      compileJpegsToPdf,
      ensureNotCancelled: checkCancel,
      autoOrient,
      stripMetadata,
      previewOnly
    }
  }

  try {
    if (actionMod.mode === 'multi') {
      const inputLabel = files.join(',')
      checkCancel()
      report(0.1, previewOnly ? '内存预览中' : `执行 ${actionMod.id}`)
      try {
        let outputPath = ''
        if (!previewOnly) {
          const baseOut = resolveOutputPath({
            inputPath: files[0],
            action: actionMod.id,
            options,
            output
          })
          outputPath = await ensureUniquePath(baseOut, overwrite)
        }
        checkCancel()
        report(0.4, `处理 ${files.length} 个文件`)

        const actionResult = await actionMod.run(buildCtx(files[0], outputPath))
        checkCancel()
        report(0.85, previewOnly ? '生成预览' : '写出结果')

        const wantPreview = previewBudget > 0 && actionMod.id !== 'pdf'
        const stats = await materializeResult(
          actionResult,
          outputPath || path.join(path.dirname(files[0]), '_preview_placeholder'),
          stripMetadata,
          { wantPreview, previewOnly }
        )
        if (stats.previewDataUrl) previewBudget -= 1
        const inSize = await fileSizeBytes(files[0])
        items.push(okItem(inputLabel, stats, inSize))
        report(1, '完成')
      } catch (err) {
        if (err && err.code === 'CANCELLED') throw err
        items.push(failItem(inputLabel, err))
        report(1, '失败')
      }
    } else {
      // per-file: independent try/catch per input
      const n = perFileList.length
      for (let i = 0; i < n; i++) {
        const inputPath = perFileList[i]
        checkCancel()
        report((i + 0.5) / n, previewOnly ? `预览 ${i + 1}/${n}` : `处理 ${i + 1}/${n}`)
        try {
          await fs.access(inputPath)
          checkCancel()
          const inSize = await fileSizeBytes(inputPath)

          // Run first so actions like compress can choose a smaller output format;
          // then resolve path extension from result.format when present.
          const actionResult = await actionMod.run(buildCtx(inputPath, ''))
          checkCancel()

          const pathOptions = { ...options }
          if (actionResult && actionResult.format) {
            pathOptions.format = actionResult.format
          }
          let outputPath = ''
          if (!previewOnly) {
            const baseOut = resolveOutputPath({
              inputPath,
              action: actionMod.id,
              options: pathOptions,
              output
            })
            outputPath = await ensureUniquePath(baseOut, overwrite)
          }

          const wantPreview = previewBudget > 0
          const stats = await materializeResult(
            actionResult,
            outputPath || path.join(path.dirname(inputPath), '_preview_placeholder'),
            stripMetadata,
            { wantPreview, previewOnly }
          )
          if (stats.previewDataUrl) previewBudget -= 1
          items.push(okItem(inputPath, stats, inSize))
        } catch (err) {
          if (err && err.code === 'CANCELLED') throw err
          items.push(failItem(inputPath, err))
        } finally {
          // Drop libvips caches between files so Windows can delete/rename
          releaseSharpResources()
        }
      }
      report(1, '完成')
    }
  } finally {
    releaseSharpResources()
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
      failed,
      previewOnly: !!previewOnly
    }
  }
}

module.exports = { runProcessImage }

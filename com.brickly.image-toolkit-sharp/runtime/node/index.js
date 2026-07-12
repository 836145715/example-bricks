/* eslint-disable */
'use strict'

/**
 * com.brickly.image-toolkit-sharp — 后端图像处理引擎
 *
 * 基于 JSON-Lines over stdin/stdout (BPP 协议 0.1.0)。
 * 核心依赖：sharp 库。
 * 实现功能：压缩、转换、尺寸、水印、圆角、补边、裁剪、旋转、翻转、图片合并、PDF合并、GIF合并。
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const { BricklyRuntime, BppError } = require('@syllm/brickly-sdk')

let _sharp = null
function loadSharp() {
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

const BRICK_ID = 'com.brickly.image-toolkit-sharp'
const brick = new BricklyRuntime({ brickId: BRICK_ID })

const cancelled = new Set()
const activeCommands = new Map()

function send(message) {
  const active = activeCommands.get(message.id)
  if (!active) return
  if (message.type === 'command.progress') {
    active.ctx.progress(message.progress, message.message)
  } else if (message.type === 'command.chunk') {
    active.ctx.chunk(message.chunk, message.name)
  } else if (message.type === 'command.output') {
    active.ctx.output(message.name, message.value)
  } else if (message.type === 'command.result') {
    active.result = message.result
  } else if (message.type === 'command.error') {
    active.error = new BppError(
      message.error?.code || 'INTERNAL_ERROR',
      message.error?.message || 'Runtime error',
      message.error?.details
    )
  }
}

function log(message, details) {
  brick.log.info(message, details)
}

function ensureNotCancelled(id) {
  if (cancelled.has(id)) {
    const err = new Error('Cancelled by host')
    err.code = 'CANCELLED'
    throw err
  }
}

// ----------------------------------------------------------------------------
// 辅助函数与独立模块
// ----------------------------------------------------------------------------

/**
 * 纯 JS 实现的极速、轻量、无第三方依赖的 JPEG 合并成多页 PDF 的编译器。
 * 流程：把任意输入图先用 sharp 统一转成 jpeg 缓存，然后拼装为标准二进制 PDF-1.4 格式。
 */
async function compileJpegsToPdf(jpegBuffers, outputPath) {
  const chunks = []
  const add = (strOrBuf) => {
    if (typeof strOrBuf === 'string') {
      chunks.push(Buffer.from(strOrBuf, 'binary'))
    } else {
      chunks.push(strOrBuf)
    }
  }

  // 1. PDF 头部
  add('%PDF-1.4\n')

  const objects = []
  const registerObject = (dict, streamData = null) => {
    const id = objects.length + 1
    objects.push({ id, dict, streamData })
    return id
  }

  // 预注册 Catalog (等会儿填充) 和 Pages (等会儿填充)
  const catalogId = 1
  const pagesId = 2
  objects.push(null) // catalog placeholder
  objects.push(null) // pages placeholder

  const pageIds = []

  // 为每一页注册 Image 和 Contents 资源
  for (let i = 0; i < jpegBuffers.length; i++) {
    const imgBuf = jpegBuffers[i]
    const sharp = loadSharp()
    const meta = await sharp(imgBuf).metadata()
    const w = meta.width || 595
    const h = meta.height || 842

    // 注册 Image XObject
    const imgObjectId = registerObject(
      {
        Type: '/XObject',
        Subtype: '/Image',
        Width: w,
        Height: h,
        ColorSpace: '/DeviceRGB',
        BitsPerComponent: 8,
        Filter: '/DCTDecode',
        Length: imgBuf.length
      },
      imgBuf
    )

    // 注册 Page 内容流 (绘制该 Image)
    // 缩放并居中画图
    const contentStream = Buffer.from(
      `q\n${w} 0 0 ${h} 0 0 cm\n/I1 Do\nQ\n`,
      'binary'
    )
    const contentObjectId = registerObject(
      {
        Length: contentStream.length
      },
      contentStream
    )

    // 注册 Page 节点
    const pageObjectId = registerObject({
      Type: '/Page',
      Parent: `${pagesId} 0 R`,
      Resources: `<< /XObject << /I1 ${imgObjectId} 0 R >> >>`,
      Contents: `${contentObjectId} 0 R`,
      MediaBox: `[0 0 ${w} ${h}]`
    })

    pageIds.push(pageObjectId)
  }

  // 填充 Catalog 和 Pages
  objects[0] = {
    id: catalogId,
    dict: {
      Type: '/Catalog',
      Pages: `${pagesId} 0 R`
    }
  }
  objects[1] = {
    id: pagesId,
    dict: {
      Type: '/Pages',
      Kids: `[${pageIds.map(id => `${id} 0 R`).join(' ')}]`,
      Count: pageIds.length
    }
  }

  // 依次写出对象并计算偏移量
  const offsets = {}
  let currentOffset = 0

  // 记录头部的偏移
  currentOffset += 8 // %PDF-1.4\n

  const writeBufs = []
  for (const obj of objects) {
    offsets[obj.id] = currentOffset
    let headerStr = `${obj.id} 0 obj\n<<\n`
    for (const [k, v] of Object.entries(obj.dict)) {
      headerStr += `  /${k} ${v}\n`
    }
    headerStr += '>>\n'
    
    let block
    if (obj.streamData) {
      const streamHead = Buffer.from(headerStr + 'stream\n', 'binary')
      const streamTail = Buffer.from('\nendstream\nendobj\n', 'binary')
      block = Buffer.concat([streamHead, obj.streamData, streamTail])
    } else {
      block = Buffer.from(headerStr + 'endobj\n', 'binary')
    }

    writeBufs.push(block)
    currentOffset += block.length
  }

  // 汇总写入 PDF 主体
  writeBufs.forEach(b => add(b))

  // 写入交叉引用表 (Xref)
  const xrefOffset = currentOffset
  let xrefStr = 'xref\n'
  xrefStr += `0 ${objects.length + 1}\n`
  xrefStr += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i++) {
    const offsetStr = String(offsets[i]).padStart(10, '0')
    xrefStr += `${offsetStr} 00000 n \n`
  }

  xrefStr += 'trailer\n'
  xrefStr += `<<\n  /Size ${objects.length + 1}\n  /Root ${catalogId} 0 R\n>>\n`
  xrefStr += 'startxref\n'
  xrefStr += `${xrefOffset}\n`
  xrefStr += '%%EOF\n'

  add(xrefStr)

  // 真正写入磁盘
  const finalPdfBuffer = Buffer.concat(chunks)
  await fs.writeFile(outputPath, finalPdfBuffer)
}

// ----------------------------------------------------------------------------
// 图像处理核心功能分发
// ----------------------------------------------------------------------------

async function cmdProcessImage(id, input) {
  const sharp = loadSharp()
  const { action, files, options = {}, outputPath } = input || {}

  if (!action) throw new Error('action 必填')
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new Error('files 数组不能为空')
  }

  // 解析得到第一个主文件，很多单图操作使用它
  const primaryFile = files[0]
  await fs.access(primaryFile) // 检查输入文件是否存在

  // 确定最终输出路径。如果不提供，默认在原文件同目录下加 Action 后缀
  let finalOutPath = outputPath
  if (!finalOutPath) {
    const parsed = path.parse(primaryFile)
    let ext = action === 'pdf' ? '.pdf' : action === 'gif' ? '.gif' : parsed.ext
    // 如果转换格式，采用目标格式的后缀
    if (action === 'convert' && options.format) {
      ext = `.${options.format}`
    }
    finalOutPath = path.join(parsed.dir, `${parsed.name}_${action}_processed${ext}`)
  }

  // 确保输出目录存在
  await fs.mkdir(path.dirname(finalOutPath), { recursive: true })

  send({ type: 'command.progress', id, progress: 0.1, message: '初始化处理' })
  ensureNotCancelled(id)

  let resultInfo = {}

  switch (action) {
    // 1. 图片压缩
    case 'compress': {
      const quality = typeof options.quality === 'number' ? options.quality : 80
      const targetSizeKb = typeof options.targetSizeKb === 'number' ? options.targetSizeKb : null
      
      const meta = await sharp(primaryFile).metadata()
      const format = meta.format || 'jpeg'

      send({ type: 'command.progress', id, progress: 0.4, message: '开始图片压缩' })

      if (targetSizeKb && ['jpeg', 'webp', 'avif'].includes(format)) {
        // 二分查找最逼近目标 KB 大小的 quality 质量
        let minQ = 5
        let maxQ = 100
        let bestQ = quality
        let bestBuffer = null
        const targetBytes = targetSizeKb * 1024

        for (let iter = 0; iter < 7; iter++) {
          ensureNotCancelled(id)
          const currentQ = Math.round((minQ + maxQ) / 2)
          let pipeline = sharp(primaryFile)
          if (format === 'jpeg') pipeline.jpeg({ quality: currentQ })
          else if (format === 'webp') pipeline.webp({ quality: currentQ })
          else if (format === 'avif') pipeline.avif({ quality: currentQ })

          const buf = await pipeline.toBuffer()
          if (buf.length <= targetBytes) {
            bestQ = currentQ
            bestBuffer = buf
            minQ = currentQ + 1 // 尝试调大质量以逼近大小
          } else {
            maxQ = currentQ - 1 // 调小质量
          }
        }

        // 如果找到了符合或最逼近的 quality，就写入它；否则默认用最后一次
        if (bestBuffer) {
          await fs.writeFile(finalOutPath, bestBuffer)
        } else {
          await sharp(primaryFile).jpeg({ quality: 5 }).toFile(finalOutPath)
        }
      } else {
        // 无目标大小，直接按指定 quality 压缩
        let pipeline = sharp(primaryFile)
        if (format === 'jpeg' || format === 'jpg') {
          pipeline.jpeg({ quality })
        } else if (format === 'webp') {
          pipeline.webp({ quality })
        } else if (format === 'png') {
          pipeline.png({ compressionLevel: 9 })
        } else if (format === 'avif') {
          pipeline.avif({ quality })
        } else {
          pipeline.toFormat(format, { quality })
        }
        await pipeline.toFile(finalOutPath)
      }
      break
    }

    // 2. 格式转换
    case 'convert': {
      const format = options.format || 'webp'
      const quality = typeof options.quality === 'number' ? options.quality : 82
      const lossless = !!options.lossless

      send({ type: 'command.progress', id, progress: 0.4, message: '开始格式转换' })

      let pipeline = sharp(primaryFile)
      if (format === 'jpeg' || format === 'jpg') {
        pipeline.jpeg({ quality })
      } else if (format === 'webp') {
        pipeline.webp({ quality, lossless })
      } else if (format === 'png') {
        pipeline.png({ compressionLevel: 9 })
      } else if (format === 'avif') {
        pipeline.avif({ quality, lossless })
      } else if (format === 'gif') {
        pipeline.gif()
      } else {
        pipeline.toFormat(format, { quality })
      }

      await pipeline.toFile(finalOutPath)
      break
    }

    // 3. 修改尺寸
    case 'resize': {
      const width = typeof options.width === 'number' ? options.width : null
      const height = typeof options.height === 'number' ? options.height : null
      const keepRatio = options.keepRatio !== false
      const scale = typeof options.scale === 'number' ? options.scale : null // 百分比, 100 为原大小
      const fit = options.fit || 'contain' // cover, contain, fill, inside, outside
      const bg = options.bg || '#00000000'

      send({ type: 'command.progress', id, progress: 0.4, message: '调整尺寸大小' })

      const meta = await sharp(primaryFile).metadata()
      let targetW = width
      let targetH = height

      if (scale) {
        targetW = Math.max(1, Math.round((meta.width || 640) * (scale / 100)))
        targetH = keepRatio ? null : Math.max(1, Math.round((meta.height || 480) * (scale / 100)))
      }

      const resizeOpts = {
        fit,
        background: bg
      }
      if (targetW) resizeOpts.width = targetW
      if (targetH) resizeOpts.height = targetH
      if (keepRatio && targetW && targetH) {
        // 强制等比例
        resizeOpts.fit = 'contain'
      } else if (!keepRatio) {
        resizeOpts.fit = 'fill'
      }

      await sharp(primaryFile)
        .resize(resizeOpts)
        .toFile(finalOutPath)
      break
    }

    // 4. 添加水印
    case 'watermark': {
      const type = options.type || 'text' // text or image
      const opacity = typeof options.opacity === 'number' ? options.opacity : 0.5
      const gravity = options.gravity || 'centre' // northeast, northwest, southeast, southwest, centre etc.

      send({ type: 'command.progress', id, progress: 0.3, message: '生成水印图层' })

      const bgMeta = await sharp(primaryFile).metadata()
      const bgW = bgMeta.width || 800
      const bgH = bgMeta.height || 600

      let overlayBuffer
      if (type === 'text') {
        const text = options.text || 'Watermark'
        const fontSize = typeof options.fontSize === 'number' ? options.fontSize : 32
        const color = options.color || '#ffffff'
        const angle = typeof options.angle === 'number' ? options.angle : 0

        // 动态计算适合文字的 SVG 容器宽高
        const estimatedW = Math.round(text.length * fontSize * 0.75 + 40)
        const estimatedH = Math.round(fontSize * 1.6 + 40)

        // 构造倾斜/旋转的 SVG 文本
        const textSvg = `
          <svg width="${estimatedW}" height="${estimatedH}">
            <text x="50%" y="50%" 
                  font-family="PingFang SC, Microsoft YaHei, sans-serif" 
                  font-weight="bold"
                  font-size="${fontSize}" 
                  fill="${color}" 
                  fill-opacity="${opacity}" 
                  text-anchor="middle" 
                  dominant-baseline="middle"
                  transform="rotate(${angle}, ${estimatedW / 2}, ${estimatedH / 2})">
              ${text}
            </text>
          </svg>
        `
        overlayBuffer = Buffer.from(textSvg, 'utf8')
      } else {
        const watermarkFile = options.watermarkFile
        if (!watermarkFile) throw new Error('图片水印必须提供 watermarkFile 路径')
        await fs.access(watermarkFile)

        const wmScale = typeof options.watermarkScale === 'number' ? options.watermarkScale : 20 // 默认占背景宽度的 20%
        const wmW = Math.max(10, Math.round(bgW * (wmScale / 100)))

        // 读取水印图片并缩放到合适宽度，同时利用 SVG image 的 opacity 特性应用透明度！
        const resizedWmBuffer = await sharp(watermarkFile).resize({ width: wmW }).png().toBuffer()
        
        // 构造包装透明度的 SVG
        const wmMeta = await sharp(resizedWmBuffer).metadata()
        const w = wmMeta.width || wmW
        const h = wmMeta.height || wmW
        const dataUrl = `data:image/png;base64,${resizedWmBuffer.toString('base64')}`
        const imgSvg = `
          <svg width="${w}" height="${h}">
            <image href="${dataUrl}" width="${w}" height="${h}" opacity="${opacity}" />
          </svg>
        `
        overlayBuffer = Buffer.from(imgSvg, 'utf8')
      }

      send({ type: 'command.progress', id, progress: 0.6, message: '混合水印图层' })

      await sharp(primaryFile)
        .composite([{ input: overlayBuffer, gravity }])
        .toFile(finalOutPath)
      break
    }

    // 5. 添加圆角
    case 'roundedCorners': {
      const radius = typeof options.radius === 'number' ? options.radius : 30
      const bg = options.bg || '#00000000'

      const meta = await sharp(primaryFile).metadata()
      const w = meta.width || 800
      const h = meta.height || 600

      send({ type: 'command.progress', id, progress: 0.4, message: '生成圆角遮罩' })

      // 利用 SVG 遮罩和 dest-in 混合模式实现完美的圆角
      const maskSvg = `
        <svg width="${w}" height="${h}">
          <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff" />
        </svg>
      `
      const maskBuffer = Buffer.from(maskSvg, 'utf8')

      let pipeline = sharp(primaryFile).composite([{ input: maskBuffer, blend: 'dest-in' }])

      // 如果背景色不是透明，需要将其叠加在一个纯色底图上
      if (bg !== '#00000000' && bg !== 'transparent') {
        const roundedBuffer = await pipeline.png().toBuffer()
        pipeline = sharp({
          create: {
            width: w,
            height: h,
            channels: 4,
            background: bg
          }
        }).composite([{ input: roundedBuffer }])
      }

      await pipeline.toFile(finalOutPath)
      break
    }

    // 6. 补边留白
    case 'padding': {
      const top = typeof options.top === 'number' ? options.top : 20
      const bottom = typeof options.bottom === 'number' ? options.bottom : 20
      const left = typeof options.left === 'number' ? options.left : 20
      const right = typeof options.right === 'number' ? options.right : 20
      const bg = options.bg || '#ffffff'

      send({ type: 'command.progress', id, progress: 0.4, message: '应用补边扩展' })

      await sharp(primaryFile)
        .extend({
          top,
          bottom,
          left,
          right,
          background: bg
        })
        .toFile(finalOutPath)
      break
    }

    // 7. 裁剪 & 13. 手动裁剪
    case 'crop':
    case 'manualCrop': {
      const x = typeof options.x === 'number' ? options.x : 0
      const y = typeof options.y === 'number' ? options.y : 0
      const w = typeof options.width === 'number' ? options.width : 200
      const h = typeof options.height === 'number' ? options.height : 200

      send({ type: 'command.progress', id, progress: 0.4, message: '提取裁剪区域' })

      const meta = await sharp(primaryFile).metadata()
      // 防御性越界裁剪校验
      const extractLeft = Math.max(0, Math.min(x, (meta.width || w) - 1))
      const extractTop = Math.max(0, Math.min(y, (meta.height || h) - 1))
      const extractWidth = Math.max(1, Math.min(w, (meta.width || w) - extractLeft))
      const extractHeight = Math.max(1, Math.min(h, (meta.height || h) - extractTop))

      await sharp(primaryFile)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractWidth,
          height: extractHeight
        })
        .toFile(finalOutPath)
      break
    }

    // 8. 旋转
    case 'rotate': {
      const angle = typeof options.angle === 'number' ? options.angle : 90
      const bg = options.bg || '#00000000'

      send({ type: 'command.progress', id, progress: 0.4, message: '应用图片旋转' })

      await sharp(primaryFile)
        .rotate(angle, { background: bg })
        .toFile(finalOutPath)
      break
    }

    // 9. 翻转
    case 'flip': {
      const horizontal = !!options.horizontal
      const vertical = !!options.vertical

      send({ type: 'command.progress', id, progress: 0.4, message: '翻转镜像处理' })

      let pipeline = sharp(primaryFile)
      if (vertical) pipeline = pipeline.flip() // 垂直
      if (horizontal) pipeline = pipeline.flop() // 水平 (Sharp flop 是水平镜像)

      await pipeline.toFile(finalOutPath)
      break
    }

    // 10. 合并为图片 (拼接)
    case 'join': {
      const direction = options.direction || 'vertical' // vertical or horizontal
      const gap = typeof options.gap === 'number' ? options.gap : 0
      const bg = options.bg || '#00000000'

      send({ type: 'command.progress', id, progress: 0.3, message: '计算拼图布局' })

      const imgMetas = []
      for (const f of files) {
        await fs.access(f)
        const m = await sharp(f).metadata()
        imgMetas.push({ file: f, width: m.width || 0, height: m.height || 0 })
      }

      let finalW = 0
      let finalH = 0

      if (direction === 'vertical') {
        finalW = Math.max(...imgMetas.map(m => m.width))
        finalH = imgMetas.reduce((sum, m) => sum + m.height, 0) + (files.length - 1) * gap
      } else {
        finalW = imgMetas.reduce((sum, m) => sum + m.width, 0) + (files.length - 1) * gap
        finalH = Math.max(...imgMetas.map(m => m.height))
      }

      send({ type: 'command.progress', id, progress: 0.5, message: '开始图片融合' })

      // 构造拼接层
      const compositeLayers = []
      let offset = 0

      for (let i = 0; i < imgMetas.length; i++) {
        const item = imgMetas[i]
        let left = 0
        let top = 0

        if (direction === 'vertical') {
          // 垂直拼接：X轴居中对齐，Y轴顺序累加
          left = Math.round((finalW - item.width) / 2)
          top = offset
          offset += item.height + gap
        } else {
          // 水平拼接：Y轴居中对齐，X轴顺序累加
          left = offset
          top = Math.round((finalH - item.height) / 2)
          offset += item.width + gap
        }

        compositeLayers.push({
          input: item.file,
          left,
          top
        })
      }

      await sharp({
        create: {
          width: finalW,
          height: finalH,
          channels: 4,
          background: bg
        }
      })
        .composite(compositeLayers)
        .toFile(finalOutPath)
      break
    }

    // 11. 合并为 PDF
    case 'pdf': {
      send({ type: 'command.progress', id, progress: 0.3, message: '准备 PDF 页缓存' })

      const jpegBuffers = []
      for (let i = 0; i < files.length; i++) {
        ensureNotCancelled(id)
        const file = files[i]
        await fs.access(file)
        
        // 统一格式化为高质量 JPEG
        const buf = await sharp(file).jpeg({ quality: 90 }).toBuffer()
        jpegBuffers.push(buf)
        
        send({
          type: 'command.progress',
          id,
          progress: 0.3 + (i / files.length) * 0.4,
          message: `转换第 ${i + 1}/${files.length} 页`
        })
      }

      send({ type: 'command.progress', id, progress: 0.8, message: '拼装输出 PDF' })
      await compileJpegsToPdf(jpegBuffers, finalOutPath)
      break
    }

    // 12. 合并为 GIF
    case 'gif': {
      send({ type: 'command.progress', id, progress: 0.3, message: '拼合动画帧' })

      const delay = typeof options.delay === 'number' ? options.delay : 200 // 默认每帧 200ms

      // 先把每张输入图缩放到与第一张一致的大小
      const firstMeta = await sharp(primaryFile).metadata()
      const w = firstMeta.width || 500
      const h = firstMeta.height || 500

      const frameBuffers = []
      for (let i = 0; i < files.length; i++) {
        ensureNotCancelled(id)
        const f = files[i]
        await fs.access(f)
        const buf = await sharp(f).resize({ width: w, height: h, fit: 'fill' }).png().toBuffer()
        frameBuffers.push(buf)
      }

      // 将所有帧垂直拼接成一张极高的大图，再告诉 sharp 这是一个 animated 图像！
      const tallBuffer = await sharp({
        create: {
          width: w,
          height: h * files.length,
          channels: 4,
          background: '#00000000'
        }
      })
        .composite(frameBuffers.map((buf, i) => ({
          input: buf,
          left: 0,
          top: i * h
        })))
        .png()
        .toBuffer()

      send({ type: 'command.progress', id, progress: 0.7, message: '生成 GIF 动画' })

      // 利用 Sharp 的 gif 帧组装
      await sharp(tallBuffer, {
        animated: true,
        pageHeight: h
      })
        .gif({
          delay: delay,
          loop: 0
        })
        .toFile(finalOutPath)
      break
    }

    default:
      throw new Error(`不支持的操作 action: ${action}`)
  }

  send({ type: 'command.progress', id, progress: 0.9, message: '收尾处理中' })
  ensureNotCancelled(id)

  const finalStat = await fs.stat(finalOutPath)
  const finalMeta = await sharp(finalOutPath).metadata().catch(() => ({}))

  resultInfo = {
    outputPath: finalOutPath,
    sizeBytes: finalStat.size,
    sizeKb: Math.round((finalStat.size / 1024) * 100) / 100,
    width: finalMeta.width || null,
    height: finalMeta.height || null,
    format: finalMeta.format || action
  }

  send({ type: 'command.progress', id, progress: 1, message: '完成' })
  send({
    type: 'command.result',
    id,
    result: resultInfo
  })
}

// ----------------------------------------------------------------------------
// SDK 命令分发器
// ----------------------------------------------------------------------------

async function handleInvoke(message) {
  const { id, commandId, input } = message
  log('开始调用', { id, commandId })
  try {
    if (commandId === 'process-image') {
      return await cmdProcessImage(id, input)
    }

    send({
      type: 'command.error',
      id,
      error: { code: 'COMMAND_NOT_FOUND', message: `未知的命令: ${commandId}` }
    })
  } catch (error) {
    const code = (error && error.code) || 'RUNTIME_ERROR'
    log('调用出错', { id, commandId, code, message: error && error.message })
    send({
      type: 'command.error',
      id,
      error: { code, message: error && error.message ? error.message : String(error) }
    })
  } finally {
    cancelled.delete(id)
    log('调用结束', { id, commandId })
  }
}

async function runWithSdk(ctx, input) {
  const active = { ctx, result: undefined, error: undefined }
  activeCommands.set(ctx.requestId, active)
  ctx.onCancel(() => {
    log('收到取消指令', { id: ctx.requestId })
    cancelled.add(ctx.requestId)
  })
  try {
    await handleInvoke({ id: ctx.requestId, commandId: ctx.commandId, input })
    if (active.error) throw active.error
    return active.result
  } finally {
    activeCommands.delete(ctx.requestId)
  }
}

brick.onCommand('process-image', runWithSdk)

brick.onShutdown(() => {
  log('收到停机指令')
})

brick.start()

process.on('uncaughtException', (e) => {
  brick.log.error('发生未捕获异常 uncaughtException', e, { message: e.message, stack: e.stack })
})

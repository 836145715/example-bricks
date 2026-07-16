'use strict'

const fs = require('node:fs/promises')
const { loadSharp } = require('./sharp-loader')

/**
 * 纯 JS 实现的极速、轻量、无第三方依赖的 JPEG 合并成多页 PDF 的编译器。
 * 流程：把任意输入图先用 sharp 统一转成 jpeg 缓存，然后拼装为标准二进制 PDF-1.4 格式。
 * @param {Buffer[]} jpegBuffers
 * @param {string} outputPath
 */
async function compileJpegsToPdf (jpegBuffers, outputPath) {
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

module.exports = { compileJpegsToPdf }

/* eslint-disable */
;(function () {
  const canvas = document.getElementById('ocrCanvas')
  const canvasPane = document.getElementById('canvasPane')
  const emptyState = document.getElementById('emptyState')
  const summary = document.getElementById('summary')
  const statusText = document.getElementById('statusText')
  const languageText = document.getElementById('languageText')
  const textList = document.getElementById('textList')
  const fitBtn = document.getElementById('fitBtn')
  const actualBtn = document.getElementById('actualBtn')
  const copyAllBtn = document.getElementById('copyAllBtn')
  const exportBtn = document.getElementById('exportBtn')
  const searchInput = document.getElementById('searchInput')
  const clearSearchBtn = document.getElementById('clearSearchBtn')
  const ctx = canvas.getContext('2d')

  let payload = null
  let image = null
  
  // Canvas 交互状态
  let zoom = 1
  let panX = 0
  let panY = 0
  let zoomMode = 'fit' // 'fit' | 'actual' | 'custom'
  let activeIndex = -1
  let selectedIndex = -1
  let searchFilter = ''

  // 拖拽平移临时变量
  let isDragging = false
  let hasDragged = false
  let startX = 0
  let startY = 0
  let startPanX = 0
  let startPanY = 0

  function sendReady() {
    if (window.brickly && typeof window.brickly.sendToParent === 'function') {
      window.brickly.sendToParent('ocr:ready')
    }
  }

  if (window.brickly && typeof window.brickly.on === 'function') {
    window.brickly.on('ocr:render', (nextPayload) => {
      void renderPayload(nextPayload)
    })
    sendReady()
  } else {
    summary.textContent = '子窗口通信不可用'
  }

  async function renderPayload(nextPayload) {
    payload = nextPayload || null
    activeIndex = -1
    selectedIndex = -1
    searchFilter = ''
    if (searchInput) {
      searchInput.value = ''
      clearSearchBtn.style.display = 'none'
    }
    
    if (!payload || !payload.screenshot || !payload.screenshot.dataUrl) return
    try {
      image = await loadImage(payload.screenshot.dataUrl)
      emptyState.classList.add('hidden')
      updateChrome()
      renderList()
      
      // 初始自适应窗口
      resetZoom()
    } catch (error) {
      summary.textContent = '图片加载失败'
      emptyState.textContent = error && error.message ? error.message : '图片加载失败'
      emptyState.classList.remove('hidden')
    }
  }

  function updateChrome() {
    const words = getWords()
    const size = payload && payload.screenshot
      ? `${payload.screenshot.width}x${payload.screenshot.height}`
      : '-'
    summary.textContent = `${words.length} 条 · ${size}`
    statusText.textContent = (payload && payload.ocr && payload.ocr.status) || '完成'
    languageText.textContent = (payload && payload.options && payload.options.languageType) || '-'
  }

  function renderList() {
    const words = getWords()
    textList.innerHTML = ''
    if (!words.length) {
      const empty = document.createElement('div')
      empty.className = 'text-item'
      empty.innerHTML = '<span class="index">0</span><div class="words-wrapper"><span class="words">未识别到文本</span></div>'
      textList.appendChild(empty)
      return
    }

    words.forEach((item, index) => {
      const row = document.createElement('div')
      row.className = 'text-item'
      row.dataset.index = String(index)
      row.innerHTML = [
        `<span class="index">${index + 1}</span>`,
        `<div class="words-wrapper">`,
          `<span class="words">${escapeHtml(String(item.words || ''))}</span>`,
          `<div class="meta-row">${formatConfidence(item)}</div>`,
        `</div>`,
        `<button class="copy-btn" title="复制文本">`,
          `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        `</button>`
      ].join('')
      
      // 单条复制按钮逻辑
      const copyBtn = row.querySelector('.copy-btn')
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          copyText(item.words || '')
        })
      }

      // 双向联动悬停与点击选择
      row.addEventListener('click', () => {
        selectItem(index, true)
      })
      row.addEventListener('mouseenter', () => {
        activeIndex = index
        draw()
      })
      row.addEventListener('mouseleave', () => {
        activeIndex = -1
        draw()
      })
      textList.appendChild(row)
    })
  }

  // 渲染画布核心
  function draw(options = {}) {
    if (!payload || !image) return
    
    // 初始化或校验画布自然宽高，以原始图片尺寸渲染以保证绝对清晰度
    if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.style.width = `${image.naturalWidth}px`
      canvas.style.height = `${image.naturalHeight}px`
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)
    
    drawBoxes(options.drawAllLabels === true)
  }

  function drawBoxes(drawAllLabels) {
    const words = getWords()
    words.forEach((item, index) => {
      const box = normalizeBox(item.location)
      if (!box) return
      
      // 过滤检测
      const isFiltered = searchFilter && !item.words.toLowerCase().includes(searchFilter.toLowerCase())
      
      const isHovered = index === activeIndex
      const isSelected = index === selectedIndex
      const confType = getConfidenceType(item)

      ctx.save()
      
      if (isFiltered) {
        ctx.globalAlpha = 0.12 // 降低不匹配项亮度
      }

      // 依据置信度或交互状态定义颜色
      let color = '#38bdf8'
      let fill = 'rgba(56, 189, 248, 0.05)'
      let lineWidth = 1.8

      if (confType === 'high') {
        color = '#10b981'
        fill = 'rgba(16, 185, 129, 0.04)'
      } else if (confType === 'mid') {
        color = '#f59e0b'
        fill = 'rgba(245, 158, 11, 0.04)'
      } else if (confType === 'low') {
        color = '#ef4444'
        fill = 'rgba(239, 68, 68, 0.04)'
      }

      if (isSelected) {
        color = '#6366f1' // 选中项靛蓝
        fill = 'rgba(99, 102, 241, 0.22)'
        lineWidth = 3.5
      } else if (isHovered) {
        color = '#06b6d4' // 悬停项青色
        fill = 'rgba(6, 182, 212, 0.16)'
        lineWidth = 2.6
      }

      // 缩放线宽与标签尺寸以适应各种自然分辨率截图
      const baseScale = Math.max(1, Math.min(image.naturalWidth, image.naturalHeight) / 1000)
      const scaledLineWidth = lineWidth * baseScale

      ctx.lineWidth = scaledLineWidth
      ctx.strokeStyle = color
      ctx.fillStyle = fill
      
      ctx.fillRect(box.left, box.top, box.width, box.height)
      ctx.strokeRect(box.left, box.top, box.width, box.height)

      // 仅在悬停、选中或强制导出时绘制顶部标注标签
      if (isHovered || isSelected || drawAllLabels) {
        drawLabel(index + 1, String(item.words || ''), box.left, box.top, box.width, box.height, color, baseScale)
      }
      
      ctx.restore()
    })
  }

  function drawLabel(index, words, x, y, width, height, color, baseScale) {
    const fontSize = Math.max(12, Math.round(14 * baseScale))
    const paddingX = Math.max(7, Math.round(9 * baseScale))
    const labelHeight = Math.ceil(fontSize * 1.5)
    ctx.font = `600 ${fontSize}px var(--font-sans), -apple-system, sans-serif`
    
    const maxLabelWidth = Math.max(120, canvas.width - 16)
    const text = fitCanvasText(`${index}. ${compactText(words, 48)}`, maxLabelWidth - paddingX * 2)
    const textWidth = Math.max(ctx.measureText(text).width + paddingX * 2, 40)
    
    // 精准贴边限制
    const labelX = clamp(x, 8, Math.max(8, canvas.width - textWidth - 8))
    const labelY = y - labelHeight - 6 >= 8
      ? y - labelHeight - 6
      : clamp(y + height + 6, 8, Math.max(8, canvas.height - labelHeight - 8))

    // 绘制标签框阴影玻璃背景
    ctx.fillStyle = 'rgba(9, 13, 22, 0.92)'
    roundRect(ctx, labelX, labelY, textWidth, labelHeight, 6)
    ctx.fill()
    
    // 绘制左侧条带指示色
    ctx.fillStyle = color
    roundRect(ctx, labelX, labelY, 4, labelHeight, 2)
    ctx.fill()

    // 绘制高阶文字
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(text, labelX + paddingX + 2, labelY + fontSize + 2)
  }

  // 选中联动处理
  function selectItem(index, shouldCenter) {
    selectedIndex = index
    
    const items = textList.querySelectorAll('.text-item')
    items.forEach((item) => {
      const itemIndex = parseInt(item.dataset.index, 10)
      if (itemIndex === selectedIndex) {
        item.classList.add('active')
        if (shouldCenter) {
          item.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      } else {
        item.classList.remove('active')
      }
    })
    
    if (index !== -1 && shouldCenter) {
      centerOnBox(index)
    }
    
    draw()
  }

  // 将 Canvas 居中对准指定的文本框
  function centerOnBox(index) {
    const words = getWords()
    const item = words[index]
    if (!item) return
    const box = normalizeBox(item.location)
    if (!box) return
    
    const paneWidth = canvasPane.clientWidth
    const paneHeight = canvasPane.clientHeight
    
    const centerX = box.left + box.width / 2
    const centerY = box.top + box.height / 2
    
    panX = paneWidth / 2 - centerX * zoom
    panY = paneHeight / 2 - centerY * zoom
    
    zoomMode = 'custom'
    applyTransform()
  }

  // 获取鼠标光标下的文本框索引
  function getBoxUnderMouse(canvasX, canvasY) {
    const words = getWords()
    // 逆序查找，优先匹配上方图层或更小的文本框
    for (let i = words.length - 1; i >= 0; i--) {
      const box = normalizeBox(words[i].location)
      if (!box) continue
      
      // 若搜索过滤生效，则跳过过滤项的选中判定
      const isFiltered = searchFilter && !words[i].words.toLowerCase().includes(searchFilter.toLowerCase())
      if (isFiltered) continue

      if (canvasX >= box.left && canvasX <= box.left + box.width &&
          canvasY >= box.top && canvasY <= box.top + box.height) {
        return i
      }
    }
    return -1
  }

  // Canvas 自适应尺寸计算与平移应用
  function resetZoom() {
    if (!image) return
    const paneWidth = canvasPane.clientWidth
    const paneHeight = canvasPane.clientHeight
    
    const padding = 48
    const scaleX = (paneWidth - padding) / image.naturalWidth
    const scaleY = (paneHeight - padding) / image.naturalHeight
    zoom = Math.min(1, scaleX, scaleY)
    
    panX = (paneWidth - image.naturalWidth * zoom) / 2
    panY = (paneHeight - image.naturalHeight * zoom) / 2
    
    zoomMode = 'fit'
    applyTransform()
    draw()
  }

  function resetToActual() {
    if (!image) return
    const paneWidth = canvasPane.clientWidth
    const paneHeight = canvasPane.clientHeight
    
    zoom = 1
    panX = (paneWidth - image.naturalWidth) / 2
    panY = (paneHeight - image.naturalHeight) / 2
    
    zoomMode = 'actual'
    applyTransform()
    draw()
  }

  function applyTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
  }

  // Canvas 拖拽、缩放、点击交互监听
  canvasPane.addEventListener('mousedown', (e) => {
    if (!image) return
    
    isDragging = true
    hasDragged = false
    startX = e.clientX
    startY = e.clientY
    startPanX = panX
    startPanY = panY
    
    canvasPane.style.cursor = 'grabbing'
  })

  canvasPane.addEventListener('mousemove', (e) => {
    if (!image) return
    
    const rect = canvasPane.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    const canvasX = (mouseX - panX) / zoom
    const canvasY = (mouseY - panY) / zoom
    
    if (isDragging) {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDragged = true
      }
      panX = startPanX + dx
      panY = startPanY + dy
      zoomMode = 'custom'
      applyTransform()
    } else {
      // 正常悬停检测
      const hoveredIndex = getBoxUnderMouse(canvasX, canvasY)
      if (hoveredIndex !== activeIndex) {
        activeIndex = hoveredIndex
        draw()
        
        // 仅悬停高亮，不自动平滑滚动（防抖晃眼），只有点击时才居中及滚动
        highlightListItem(activeIndex)
      }
    }
  })

  canvasPane.addEventListener('mouseup', (e) => {
    if (!image) return
    isDragging = false
    canvasPane.style.cursor = 'grab'
    
    if (!hasDragged) {
      // 单击事件：计算是否点击在文字框内
      const rect = canvasPane.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      const canvasX = (mouseX - panX) / zoom
      const canvasY = (mouseY - panY) / zoom
      
      const clickedIndex = getBoxUnderMouse(canvasX, canvasY)
      selectItem(clickedIndex, false) // 画布点击高亮，但不挪移画布以免错乱
    }
  })

  canvasPane.addEventListener('mouseleave', () => {
    isDragging = false
    canvasPane.style.cursor = 'grab'
    if (activeIndex !== -1) {
      activeIndex = -1
      draw()
      highlightListItem(-1)
    }
  })

  // 滚轮无级缩放
  canvasPane.addEventListener('wheel', (e) => {
    if (!image) return
    e.preventDefault()
    
    const rect = canvasPane.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    const canvasX = (mouseX - panX) / zoom
    const canvasY = (mouseY - panY) / zoom
    
    // 依据 deltaY 动态计算缩放因子，兼顾高精度的 Mac 触控板（小 deltaY）和普通滚轮（大 deltaY）
    const factor = 1 - e.deltaY * 0.0008
    const clampedFactor = Math.min(1.05, Math.max(0.95, factor)) // 限制单次事件最大缩放变化为 5%
    let newZoom = zoom * clampedFactor
    newZoom = Math.min(8, Math.max(0.15, newZoom))
    
    panX = mouseX - canvasX * newZoom
    panY = mouseY - canvasY * newZoom
    zoom = newZoom
    
    zoomMode = 'custom'
    applyTransform()
  }, { passive: false })

  // 搜索框过滤逻辑
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchFilter = e.target.value.trim()
      if (searchFilter) {
        clearSearchBtn.style.display = 'flex'
      } else {
        clearSearchBtn.style.display = 'none'
      }
      filterListAndCanvas()
    })

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = ''
      searchFilter = ''
      clearSearchBtn.style.display = 'none'
      filterListAndCanvas()
    })
  }

  function filterListAndCanvas() {
    const items = textList.querySelectorAll('.text-item')
    items.forEach((item) => {
      const words = item.querySelector('.words').textContent.toLowerCase()
      const matches = !searchFilter || words.includes(searchFilter.toLowerCase())
      if (matches) {
        item.classList.remove('dimmed')
        item.style.display = ''
      } else {
        item.classList.add('dimmed')
        item.style.display = 'none'
      }
    })
    
    // 如果选中的项被过滤掉了，清除选中态
    if (selectedIndex !== -1) {
      const words = getWords()
      const selectedItem = words[selectedIndex]
      if (selectedItem && searchFilter && !selectedItem.words.toLowerCase().includes(searchFilter.toLowerCase())) {
        selectItem(-1, false)
      }
    }
    
    draw()
  }

  // 工具函数与置信度等级判定
  function getConfidenceType(item) {
    const prob = item && item.probability && Number(item.probability.average)
    if (!Number.isFinite(prob)) return 'high'
    if (prob >= 0.9) return 'high'
    if (prob >= 0.75) return 'mid'
    return 'low'
  }

  function highlightListItem(index) {
    const items = textList.querySelectorAll('.text-item')
    items.forEach((item) => {
      const itemIndex = parseInt(item.dataset.index, 10)
      if (itemIndex === index) {
        item.classList.add('active')
      } else if (itemIndex !== selectedIndex) {
        item.classList.remove('active')
      }
    })
  }

  function getWords() {
    return payload && payload.ocr && Array.isArray(payload.ocr.wordsResult)
      ? payload.ocr.wordsResult
      : []
  }

  function normalizeBox(location) {
    if (!location || typeof location !== 'object') return null
    const left = Number(location.left)
    const top = Number(location.top)
    const width = Number(location.width)
    const height = Number(location.height)
    if (![left, top, width, height].every(Number.isFinite)) return null
    if (width <= 0 || height <= 0) return null
    return { left, top, width, height }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = src
    })
  }

  // 复制文本及 Toast 通知
  async function copyText(text) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      showToast('文本已复制到剪贴板')
    } catch (e) {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
      showToast('文本已复制到剪贴板')
    }
  }

  async function copyAllText() {
    const words = getWords()
    const allText = words.map((w) => w.words || '').filter(Boolean).join('\n')
    if (!allText) {
      showToast('没有可复制的文本', 'error')
      return
    }
    await copyText(allText)
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer')
    if (!container) return
    
    const toast = document.createElement('div')
    toast.className = 'toast'
    
    const icon = type === 'success'
      ? `<svg class="toast-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
      : `<svg class="toast-icon" style="color: var(--color-danger);" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      
    toast.innerHTML = `${icon}<span>${message}</span>`
    container.appendChild(toast)
    
    setTimeout(() => {
      toast.remove()
    }, 2500)
  }

  function exportPng() {
    if (!payload || !image) return
    
    // 导出时绘制全部标签
    draw({ drawAllLabels: true })
    
    const link = document.createElement('a')
    const baseName = payload.screenshot && payload.screenshot.name
      ? payload.screenshot.name.replace(/\.[^.]+$/, '')
      : 'glm-ocr'
    link.download = `${baseName}-annotated.png`
    link.href = canvas.toDataURL('image/png')
    document.body.appendChild(link)
    link.click()
    link.remove()
    
    // 恢复正常预览
    draw()
    showToast('已导出标注完成的图片！')
  }

  function formatConfidence(item) {
    const probability = item && item.probability
    const raw = probability && Number(probability.average)
    if (!Number.isFinite(raw)) return ''
    
    const percentage = (raw * 100).toFixed(1)
    const confType = getConfidenceType(item)
    
    let label = '高置信度'
    if (confType === 'mid') label = '中置信度'
    if (confType === 'low') label = '低置信度'
    
    return `<span class="confidence ${confType}">${label} ${percentage}%</span>`
  }

  function compactText(text, limit) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim()
    return clean.length > limit ? `${clean.slice(0, limit - 3)}...` : clean
  }

  function fitCanvasText(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text
    let output = text
    while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
      output = output.slice(0, -1)
    }
    return `${output}...`
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        case '"':
          return '&quot;'
        case "'":
          return '&#39;'
        default:
          return char
      }
    })
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function roundRect(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2)
    context.beginPath()
    context.moveTo(x + safeRadius, y)
    context.lineTo(x + width - safeRadius, y)
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
    context.lineTo(x + width, y + height - safeRadius)
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
    context.lineTo(x + safeRadius, y + height)
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
    context.lineTo(x, y + safeRadius)
    context.quadraticCurveTo(x, y, x + safeRadius, y)
    context.closePath()
  }

  fitBtn.addEventListener('click', resetZoom)
  actualBtn.addEventListener('click', resetToActual)
  copyAllBtn.addEventListener('click', copyAllText)
  exportBtn.addEventListener('click', exportPng)
  
  window.addEventListener('resize', () => {
    if (zoomMode === 'fit') resetZoom()
  })
})()

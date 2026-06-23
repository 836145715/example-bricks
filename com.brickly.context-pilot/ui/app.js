/* eslint-disable */
'use strict'

const SECTION_TITLES = {
  natural_translation: '自然翻译',
  literal_translation: '结构直译',
  skeleton: '句子主干',
  chunks: '短语拆解',
  patterns: '表达公式'
}

const statusEl = document.getElementById('status')
const statusDotEl = document.getElementById('status-dot')
const sourceEl = document.getElementById('source')
const sectionsEl = document.getElementById('sections')
const fallbackEl = document.getElementById('fallback')
const errorEl = document.getElementById('error')
const copyButton = document.getElementById('copy')
const closeButton = document.getElementById('close')

let fullMarkdown = ''
let activeRequestId = ''
let resizeFrame = 0
let lastRequestedHeight = 0

copyButton.addEventListener('click', async () => {
  if (!fullMarkdown) return
  try {
    await navigator.clipboard.writeText(fullMarkdown)
    const previousText = copyButton.textContent
    copyButton.textContent = '已复制'
    setStatus('解构结果已复制', 'ready')
    window.setTimeout(() => {
      copyButton.textContent = previousText
    }, 1200)
  } catch (error) {
    showError(`复制失败：${errorMessage(error)}`)
  }
})

closeButton.addEventListener('click', () => {
  window.brickly?.sendToParent?.('context-pilot:close')
})

if (window.brickly?.on) {
  window.brickly.on('context-pilot:start', (payload) => {
    activeRequestId = textOrFallback(payload?.requestId, '')
    fullMarkdown = ''
    copyButton.disabled = true
    errorEl.hidden = true
    errorEl.textContent = ''
    fallbackEl.hidden = true
    fallbackEl.textContent = ''
    sourceEl.textContent = textOrFallback(payload?.sourceText, '暂无内容')
    resetSections()
    sectionsEl.classList.add('streaming')
    setStatus('正在解构', 'busy')
    requestPanelResize()
  })

  window.brickly.on('context-pilot:delta', (payload) => {
    if (!acceptAnalysisPayload(payload)) return
    const delta = textOrFallback(payload?.delta, '')
    if (!delta) return
    fullMarkdown += delta
    renderProtocolMarkdown(fullMarkdown)
    setStatus('正在输出', 'busy')
    requestPanelResize()
  })

  window.brickly.on('context-pilot:result', (payload) => {
    if (!acceptAnalysisPayload(payload)) return
    fullMarkdown = textOrFallback(payload?.markdown, fullMarkdown)
    sourceEl.textContent = textOrFallback(payload?.sourceText, sourceEl.textContent)
    renderProtocolMarkdown(fullMarkdown)
    sectionsEl.classList.remove('streaming')
    copyButton.disabled = !fullMarkdown
    markMissingSectionsIdle()
    setStatus('解构完成', 'ready')
    requestPanelResize()
  })

  window.brickly.on('context-pilot:error', (payload) => {
    if (!acceptAnalysisPayload(payload)) return
    sourceEl.textContent = textOrFallback(payload?.sourceText, sourceEl.textContent)
    fullMarkdown = ''
    copyButton.disabled = true
    sectionsEl.classList.remove('streaming')
    resetSections('解构失败')
    showError(textOrFallback(payload?.error, '未知错误'))
    setStatus('解构失败', 'error')
    requestPanelResize()
  })
} else {
  showError('window.brickly 未加载')
  requestPanelResize()
}

function renderProtocolMarkdown(markdown) {
  const parsed = parseSections(markdown)
  let renderedAny = false
  const activeKey = parsed.order[parsed.order.length - 1]
  for (const key of Object.keys(SECTION_TITLES)) {
    const section = getSection(key)
    const body = getSectionBody(key)
    const value = parsed.sections[key]?.trim()
    if (value) {
      body.innerHTML = renderInlineMarkdown(value)
      body.classList.remove('muted')
      body.classList.add('stream-chunk')
      section.dataset.state = key === activeKey ? 'active' : 'ready'
      renderedAny = true
    } else {
      body.textContent = '等待输出'
      body.classList.add('muted')
      body.classList.remove('stream-chunk')
      section.dataset.state = 'pending'
    }
  }
  fallbackEl.hidden = renderedAny || !parsed.fallback.trim()
  fallbackEl.textContent = parsed.fallback.trim()
}

function parseSections(markdown) {
  const sections = {}
  const order = []
  const markerPattern = /^\[SECTION:([a-z_]+)\]\s*$/gm
  const markers = []
  let match
  while ((match = markerPattern.exec(markdown))) {
    markers.push({ key: match[1], index: match.index, end: markerPattern.lastIndex })
    order.push(match[1])
  }
  if (markers.length === 0) return { sections, order, fallback: markdown }
  const fallback = markdown.slice(0, markers[0].index)
  markers.forEach((marker, index) => {
    const next = markers[index + 1]
    sections[marker.key] = markdown.slice(marker.end, next ? next.index : markdown.length)
  })
  return { sections, order, fallback }
}

function renderInlineMarkdown(value) {
  const escaped = escapeHtml(value.trim())
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^- /gm, '<span class="bullet">•</span> ')
    .replace(/\n/g, '<br />')
}

function resetSections(text = '等待分析') {
  for (const key of Object.keys(SECTION_TITLES)) {
    const section = getSection(key)
    const body = getSectionBody(key)
    section.dataset.state = 'pending'
    body.textContent = text
    body.classList.add('muted')
    body.classList.remove('stream-chunk')
  }
}

function markMissingSectionsIdle() {
  for (const key of Object.keys(SECTION_TITLES)) {
    const section = getSection(key)
    const body = getSectionBody(key)
    if (section.dataset.state === 'pending') {
      body.textContent = '未输出'
      section.dataset.state = 'idle'
    } else if (section.dataset.state === 'active') {
      section.dataset.state = 'ready'
    }
  }
}

function getSection(key) {
  return document.querySelector(`[data-section="${key}"]`)
}

function getSectionBody(key) {
  return document.querySelector(`[data-section="${key}"] .section-body`)
}

function setStatus(text, state = 'idle') {
  statusEl.lastChild.textContent = text
  statusDotEl.className = `status-dot ${state}`
}

function showError(text) {
  errorEl.hidden = false
  errorEl.textContent = text
}

function textOrFallback(value, fallback) {
  return typeof value === 'string' && value ? value : fallback
}

function acceptAnalysisPayload(payload) {
  const requestId = textOrFallback(payload?.requestId, '')
  return Boolean(requestId && requestId === activeRequestId)
}

function requestPanelResize() {
  if (!window.brickly?.sendToParent) return
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    const height = Math.ceil(document.querySelector('.shell').scrollHeight + 18)
    if (Math.abs(height - lastRequestedHeight) < 4) return
    lastRequestedHeight = height
    window.brickly.sendToParent('context-pilot:resize', { height })
  })
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

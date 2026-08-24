'use strict'

const MAX_SOURCE_CHARS = 8000

function selectedTextFromSnapshots(before, after) {
  if (!after || after.kind !== 'text') return { text: '', reason: 'clipboard-not-text' }
  const text = typeof after.text === 'string' ? after.text.trim() : ''
  if (!text) return { text: '', reason: 'clipboard-empty-text' }
  if (before && before.hash && after.hash && before.hash === after.hash) {
    return { text: '', reason: 'clipboard-hash-unchanged' }
  }
  return { text: text.slice(0, MAX_SOURCE_CHARS), reason: 'selected-text' }
}

function clipboardContentFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null
  if (snapshot.kind === 'text' && typeof snapshot.text === 'string') {
    return { kind: 'text', text: snapshot.text }
  }
  if (snapshot.kind === 'file' && Array.isArray(snapshot.paths) && snapshot.paths.length > 0) {
    const paths = snapshot.paths.filter((item) => typeof item === 'string')
    return paths.length > 0 ? { kind: 'file', paths } : null
  }
  if (snapshot.kind === 'image') {
    if (typeof snapshot.path === 'string' && snapshot.path) return { kind: 'image', path: snapshot.path }
    if (snapshot.resource && typeof snapshot.resource.filePath === 'string') {
      return { kind: 'image', path: snapshot.resource.filePath }
    }
  }
  return null
}

function normalizeScreenBounds(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const width = Number(value.width)
  const height = Number(value.height)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

module.exports = {
  MAX_SOURCE_CHARS,
  selectedTextFromSnapshots,
  clipboardContentFromSnapshot,
  normalizeScreenBounds
}

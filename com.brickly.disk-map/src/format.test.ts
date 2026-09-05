import assert from 'node:assert/strict'
import { test } from 'node:test'

import { categoryColor, extCategory, nodeFill } from './format.ts'
import type { NodeSummary } from './types.ts'

function summary(name: string, kind: NodeSummary['flags']['kind'] = 'file'): NodeSummary {
  return {
    path: `/tmp/${name}`,
    name,
    allocatedBytes: 10,
    logicalBytes: 10,
    fileCount: kind === 'file' ? 1 : 0,
    dirCount: kind === 'dir' ? 1 : 0,
    complete: true,
    flags: { kind, protected: false, inaccessible: false, dataless: false, mount: false }
  }
}

test('extCategory maps known suffixes and Docker.raw to disk', () => {
  assert.equal(extCategory('.MP4'), 'video')
  assert.equal(extCategory('mkv'), 'video')
  assert.equal(extCategory('.flac'), 'audio')
  assert.equal(extCategory('.heic'), 'image')
  assert.equal(extCategory('.dmg'), 'archive')
  assert.equal(extCategory('.tsx'), 'code')
  assert.equal(extCategory('.pdf'), 'doc')
  assert.equal(extCategory('.vmdk'), 'disk')
  assert.equal(extCategory('.bin'), 'other')
  assert.equal(extCategory(''), 'other')
  assert.equal(extCategory('(无后缀)'), 'other')
  assert.equal(extCategory('.raw', 'Docker.raw'), 'disk')
  assert.equal(extCategory('.raw', 'photo.raw'), 'image')
})

test('categoryColor is stable per category and distinct', () => {
  const colors = ['video', 'audio', 'image', 'archive', 'code', 'doc', 'disk', 'other', 'dir'] as const
  const seen = new Set(colors.map((cat) => categoryColor(cat)))
  assert.equal(seen.size, colors.length)
  assert.match(categoryColor('video'), /^hsl\(/)
})

test('fills stay muted so they sit on the dark scanning console', () => {
  const colors = ['video', 'audio', 'image', 'archive', 'code', 'doc', 'disk', 'other', 'dir'] as const
  for (const cat of colors) {
    const light = Number(categoryColor(cat).match(/(\d+(?:\.\d+)?)%\)$/)?.[1])
    const sat = Number(categoryColor(cat).match(/\s(\d+(?:\.\d+)?)%\s/)?.[1])
    assert.ok(light <= 46, `${cat} lightness ${light}`)
    assert.ok(sat <= 55, `${cat} saturation ${sat}`)
  }
  const dirFill = nodeFill(summary('Caches', 'dir'))
  const dirLight = Number(dirFill.match(/(\d+(?:\.\d+)?)%\)$/)?.[1])
  const dirSat = Number(dirFill.match(/\s(\d+(?:\.\d+)?)%\s/)?.[1])
  assert.ok(dirLight <= 40, `dir lightness ${dirLight}`)
  assert.ok(dirSat <= 42, `dir saturation ${dirSat}`)
})

test('nodeFill: directories hash by name, files follow extension category', () => {
  const dirA = nodeFill(summary('Caches', 'dir'))
  const dirB = nodeFill(summary('Caches', 'dir'))
  const dirC = nodeFill(summary('Library', 'dir'))
  assert.equal(dirA, dirB)
  assert.notEqual(dirA, dirC)

  assert.equal(nodeFill(summary('clip.mp4')), categoryColor('video'))
  assert.equal(nodeFill(summary('Docker.raw')), categoryColor('disk'))
  assert.equal(nodeFill(summary('photo.raw')), categoryColor('image'))
  assert.equal(nodeFill(summary('notes', 'file')), categoryColor('other'))
})

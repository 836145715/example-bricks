import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chartLayerKey, pieLabelText, toPieData, toTreemapData, unwrapChartNode } from './chart-data.ts'
import type { NodeSummary, TreeNode } from './types.ts'

function file(name: string, bytes: number, path = `/root/${name}`): NodeSummary {
  return {
    path,
    name,
    allocatedBytes: bytes,
    logicalBytes: bytes,
    fileCount: 1,
    dirCount: 0,
    complete: true,
    flags: { kind: 'file', protected: false, inaccessible: false, dataless: false, mount: false }
  }
}

function dir(name: string, bytes: number, children: NodeSummary[], path = `/root/${name}`): TreeNode {
  return {
    path,
    name,
    allocatedBytes: bytes,
    logicalBytes: bytes,
    fileCount: children.length,
    dirCount: 0,
    complete: true,
    flags: { kind: 'dir', protected: false, inaccessible: false, dataless: false, mount: false },
    children
  }
}

test('toPieData is a flat slice list of this folder only: skips links, never nests, no free-space wedge', () => {
  const link: NodeSummary = {
    ...file('alias', 0, '/root/alias'),
    flags: { kind: 'link', protected: false, inaccessible: false, dataless: false, mount: false }
  }
  const nested = dir('docs', 80, [file('a.pdf', 50, '/root/docs/a.pdf')], '/root/docs')
  const root = dir('home', 200, [file('clip.mp4', 120, '/root/clip.mp4'), nested, link], '/root')
  const data = toPieData(root)
  assert.deepEqual(
    data.map((c) => c.name),
    ['clip.mp4', 'docs']
  )
  assert.equal(
    data.every((c) => c.children === undefined && !c.isFree),
    true
  )
  assert.equal(data[0].label, 'clip.mp4 60%')
})

test('pieLabelText shows name and percent for large slices, hides tiny ones', () => {
  const slices = toPieData(
    dir('home', 121, [file('clip.mp4', 120, '/root/clip.mp4'), file('tiny.bin', 1, '/root/tiny.bin')], '/root')
  )
  assert.equal(pieLabelText(slices[0], slices), 'clip.mp4 99%')
  assert.equal(pieLabelText(slices[1], slices), '')
  assert.equal(slices[0].label, 'clip.mp4 99%')
  assert.equal(slices[1].label, '')
})

test('toTreemapData is one layer of children without free space or nested select', () => {
  const nested = dir('docs', 80, [file('a.pdf', 50, '/root/docs/a.pdf')], '/root/docs')
  const root = dir('home', 200, [file('clip.mp4', 120, '/root/clip.mp4'), nested], '/root')
  const data = toTreemapData(root)
  assert.equal(data.children!.some((c) => c.isFree), false)
  const docs = data.children!.find((c) => c.name === 'docs')
  assert.equal(docs?.children, undefined)
})

test('chartLayerKey stays stable when only object identity changes', () => {
  const nested = dir('docs', 80, [file('a.pdf', 50, '/root/docs/a.pdf')], '/root/docs')
  const root = dir('home', 200, [file('clip.mp4', 120, '/root/clip.mp4'), nested], '/root')
  const clone = { ...root, children: root.children.map((child) => ({ ...child })) }
  assert.equal(chartLayerKey(root), chartLayerKey(clone))
  assert.notEqual(chartLayerKey(root), chartLayerKey({ ...root, path: '/other' }))
})

test('unwrapChartNode walks G2 event payloads to the original node', () => {
  const node = {
    name: 'clip.mp4',
    value: 10,
    color: 'red',
    summary: file('clip.mp4', 10)
  }
  assert.equal(unwrapChartNode({ data: { data: node } })?.name, 'clip.mp4')
  assert.equal(unwrapChartNode({ __data__: { data: node } })?.name, 'clip.mp4')
  assert.equal(unwrapChartNode(node)?.summary.path, '/root/clip.mp4')
})

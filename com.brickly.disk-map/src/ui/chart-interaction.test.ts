import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  actOnChartNode,
  isChartNodeSelected,
  nodeFromChartEvent,
  type ChartNode
} from './chart-data.ts'
import { emptyHintFor } from './emptyHint.ts'
import type { NodeSummary } from './types.ts'

function flags(kind: NodeSummary['flags']['kind']) {
  return { kind, protected: false, inaccessible: false, dataless: false, mount: false }
}

function summary(name: string, kind: NodeSummary['flags']['kind'], path: string): NodeSummary {
  return {
    path,
    name,
    allocatedBytes: 100,
    logicalBytes: 100,
    fileCount: kind === 'file' ? 1 : 0,
    dirCount: kind === 'dir' ? 1 : 0,
    complete: true,
    flags: flags(kind)
  }
}

function chartNode(name: string, kind: NodeSummary['flags']['kind'], path: string): ChartNode {
  return { name, value: 100, color: '#fff', summary: summary(name, kind, path) }
}

function calls() {
  const selected: Array<string | null> = []
  const drilled: string[] = []
  return {
    selected,
    drilled,
    onSelect: (p: string | null) => void selected.push(p),
    onDrill: (p: string) => void drilled.push(p)
  }
}

test('actOnChartNode drills into directories', () => {
  const c = calls()
  actOnChartNode(chartNode('docs', 'dir', '/root/docs'), c.onSelect, c.onDrill)
  assert.deepEqual(c.drilled, ['/root/docs'])
  assert.deepEqual(c.selected, [])
})

test('actOnChartNode selects files', () => {
  const c = calls()
  actOnChartNode(chartNode('a.pdf', 'file', '/root/a.pdf'), c.onSelect, c.onDrill)
  assert.deepEqual(c.selected, ['/root/a.pdf'])
  assert.deepEqual(c.drilled, [])
})

test('actOnChartNode ignores the other bucket and empty areas', () => {
  const c = calls()
  // other 聚合行 path 为空：与列表一致，不做任何事。
  actOnChartNode(chartNode('其他', 'other', ''), c.onSelect, c.onDrill)
  // 空白处 / isFree 楔块：清除选中。
  actOnChartNode(undefined, c.onSelect, c.onDrill)
  actOnChartNode({ ...chartNode('x', 'file', '/root/x'), isFree: true }, c.onSelect, c.onDrill)
  assert.deepEqual(c.drilled, [])
  assert.deepEqual(c.selected, [null, null])
})

test('isChartNodeSelected matches by path only', () => {
  const node = chartNode('a.pdf', 'file', '/root/a.pdf')
  assert.equal(isChartNodeSelected(node, '/root/a.pdf'), true)
  assert.equal(isChartNodeSelected(node, '/root/other.pdf'), false)
  assert.equal(isChartNodeSelected(node, null), false)
  assert.equal(isChartNodeSelected(undefined, '/root/a.pdf'), false)
  assert.equal(isChartNodeSelected(chartNode('其他', 'other', ''), ''), false)
})

test('nodeFromChartEvent unwraps G2 payloads', () => {
  const node = chartNode('docs', 'dir', '/root/docs')
  // G2 element:click 的 e.data = { data: 原始数据 }。
  assert.equal(nodeFromChartEvent({ data: { data: node } }), node)
  // tooltip 回调里的 datum 本身就是节点。
  assert.equal(nodeFromChartEvent(node), node)
  // G 的 __data__ 包裹。
  assert.equal(nodeFromChartEvent({ __data__: { data: node } }), node)
  // 陌生对象返回 undefined，不抛错。
  assert.equal(nodeFromChartEvent({ foo: 1 }), undefined)
  assert.equal(nodeFromChartEvent(null), undefined)
})

test('emptyHintFor covers every scan status', () => {
  assert.equal(emptyHintFor('booting'), '正在启动扫描…')
  assert.equal(emptyHintFor('scanning'), '扫描尚未到达此目录，稍后会自动出现')
  assert.equal(emptyHintFor('done'), '此目录不在本次扫描结果里')
  assert.equal(emptyHintFor('cancelled'), '扫描已取消，重新扫描后重试')
  assert.equal(emptyHintFor('error'), '扫描出错，重新扫描后重试')
  assert.equal(emptyHintFor('idle'), '等待扫描…')
})

/* eslint-disable */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseUnixProcessNames,
  parseUnixProcessSummary,
  parseWindowsProcessDetails,
  parseLsof,
  parseSs,
  parseWindowsNetstat,
  resolveProcessName
} = require('../services/port-inspector.cjs')

test('parseWindowsNetstat parses TCP and UDP rows', () => {
  const rows = parseWindowsNetstat(`
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       1234
  UDP    0.0.0.0:5353           *:*                                    888
`)

  assert.deepEqual(rows, [
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      localPort: 3000,
      remoteAddress: '0.0.0.0',
      remotePort: 0,
      state: 'LISTENING',
      pid: 1234,
      processName: null
    },
    {
      protocol: 'udp',
      localAddress: '0.0.0.0',
      localPort: 5353,
      remoteAddress: '*',
      remotePort: null,
      state: '',
      pid: 888,
      processName: null
    }
  ])
})

test('parseLsof parses process name, pid and listening state', () => {
  const rows = parseLsof(`
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 user   25u  IPv4 123456      0t0  TCP 127.0.0.1:5173 (LISTEN)
Code    22222 user   29u  IPv4 777777      0t0  UDP *:5353
`)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].processName, 'node')
  assert.equal(rows[0].pid, 12345)
  assert.equal(rows[0].localPort, 5173)
  assert.equal(rows[0].state, 'LISTEN')
  assert.equal(rows[1].protocol, 'udp')
  assert.equal(rows[1].localPort, 5353)
})

test('parseSs parses Linux process metadata', () => {
  const rows = parseSs(`
tcp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=4242,fd=23))
udp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi-daemon",pid=777,fd=12))
`)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].protocol, 'tcp')
  assert.equal(rows[0].processName, 'node')
  assert.equal(rows[0].pid, 4242)
  assert.equal(rows[0].localPort, 3000)
  assert.equal(rows[1].protocol, 'udp')
  assert.equal(rows[1].processName, 'avahi-daemon')
  assert.equal(rows[1].localPort, 5353)
})

test('parseUnixProcessNames normalizes macOS app paths', () => {
  const names = parseUnixProcessNames(`
  4538 /Applications/\u4F18\u9177.app/Contents/MacOS/\u4F18\u9177
  4242 /usr/local/bin/node
`)

  assert.equal(names.get(4538), '\u4F18\u9177')
  assert.equal(names.get(4242), 'node')
})

test('resolveProcessName prefers enriched name over malformed command column', () => {
  assert.equal(resolveProcessName('\uFFFDx98\uFFFD', '/Applications/\u4F18\u9177.app/Contents/MacOS/\u4F18\u9177'), '\u4F18\u9177')
  assert.equal(resolveProcessName('node', null), 'node')
  assert.equal(resolveProcessName('\uFFFDx98\uFFFD', null), null)
})

test('parseUnixProcessSummary parses readonly process details', () => {
  const summary = parseUnixProcessSummary(' 4538     1 xuan S    05-01:03:33 /Applications/\u4F18\u9177.app/Contents/MacOS/\u4F18\u9177\n')

  assert.deepEqual(summary, {
    pid: 4538,
    parentPid: 1,
    user: 'xuan',
    state: 'S',
    elapsed: '05-01:03:33',
    executablePath: '/Applications/\u4F18\u9177.app/Contents/MacOS/\u4F18\u9177',
    processName: '\u4F18\u9177'
  })
})

test('parseWindowsProcessDetails parses PowerShell CIM json', () => {
  const details = parseWindowsProcessDetails(
    JSON.stringify({
      ProcessId: 4321,
      ParentProcessId: 100,
      Name: 'node.exe',
      ExecutablePath: 'C:\\\\Program Files\\\\nodejs\\\\node.exe',
      CommandLine: '"C:\\\\Program Files\\\\nodejs\\\\node.exe" server.js',
      CreationDate: '2026-06-08T21:00:00.0000000+08:00',
      User: 'DESKTOP\\\\xuan'
    })
  )

  assert.deepEqual(details, {
    pid: 4321,
    parentPid: 100,
    processName: 'node.exe',
    executablePath: 'C:\\\\Program Files\\\\nodejs\\\\node.exe',
    commandLine: '"C:\\\\Program Files\\\\nodejs\\\\node.exe" server.js',
    startedAt: '2026-06-08T21:00:00.0000000+08:00',
    user: 'DESKTOP\\\\xuan'
  })
})

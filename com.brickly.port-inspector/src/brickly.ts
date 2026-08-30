/**
 * Brickly API Bridge 交互桥梁
 * 包含原生环境 IPC 调用与 Dev 开发环境 Mock 兜底
 */

import type { KillProcessResult, PortQueryResult, ProcessDetails, ProtocolFilter } from './types'

// Mock 假数据，仅在非 Brickly 环境（如纯 Vite 预览）下使用
const MOCK_ROWS: PortQueryResult = {
  platform: 'windows',
  protocol: 'all',
  query: '',
  count: 7,
  generatedAt: new Date().toISOString(),
  method: 'api',
  rows: [
    {
      protocol: 'tcp',
      localAddress: '0.0.0.0',
      localPort: 3000,
      remoteAddress: '0.0.0.0',
      remotePort: 0,
      state: 'LISTENING',
      pid: 14528,
      processName: 'node.exe',
      executablePath: 'C:\\Program Files\\nodejs\\node.exe'
    },
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      localPort: 8080,
      remoteAddress: '0.0.0.0',
      remotePort: 0,
      state: 'LISTENING',
      pid: 22104,
      processName: 'javaw.exe',
      executablePath: 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe'
    },
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      localPort: 5173,
      remoteAddress: '0.0.0.0',
      remotePort: 0,
      state: 'LISTENING',
      pid: 9812,
      processName: 'vite.exe',
      executablePath: 'D:\\brick-project\\node_modules\\.bin\\vite.exe'
    },
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      localPort: 3306,
      remoteAddress: '0.0.0.0',
      remotePort: 0,
      state: 'LISTENING',
      pid: 4320,
      processName: 'mysqld.exe',
      executablePath: 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe'
    },
    {
      protocol: 'tcp',
      localAddress: '192.168.1.105',
      localPort: 52140,
      remoteAddress: '140.82.113.3',
      remotePort: 443,
      state: 'ESTABLISHED',
      pid: 8840,
      processName: 'chrome.exe',
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    },
    {
      protocol: 'udp',
      localAddress: '0.0.0.0',
      localPort: 5353,
      remoteAddress: '*',
      remotePort: null,
      state: '',
      pid: 1120,
      processName: 'svchost.exe',
      executablePath: 'C:\\Windows\\System32\\svchost.exe'
    },
    {
      protocol: 'tcp',
      localAddress: '127.0.0.1',
      localPort: 6379,
      remoteAddress: '0.0.0.0',
      remotePort: 0,
      state: 'LISTENING',
      pid: 6712,
      processName: 'redis-server.exe',
      executablePath: 'C:\\Program Files\\Redis\\redis-server.exe'
    }
  ]
}

function hasBrickly(): boolean {
  return Boolean(window.brickly && typeof window.brickly.invoke === 'function')
}

/** 查询特定端口占用情况 */
export async function lookupPort(port: number, protocol: ProtocolFilter): Promise<PortQueryResult> {
  if (hasBrickly()) {
    return window.brickly!.invoke('lookup', { port, protocol }) as Promise<PortQueryResult>
  }
  // Mock 逻辑
  await new Promise((resolve) => setTimeout(resolve, 250))
  const matched = MOCK_ROWS.rows.filter((r) => r.localPort === port && (protocol === 'all' || r.protocol === protocol))
  return {
    ...MOCK_ROWS,
    query: String(port),
    protocol,
    count: matched.length,
    rows: matched,
    generatedAt: new Date().toISOString()
  }
}

/** 查询全部/过滤端口列表 */
export async function listPorts(input: {
  query: string
  protocol: ProtocolFilter
  includeEstablished: boolean
  limit: number
}): Promise<PortQueryResult> {
  if (hasBrickly()) {
    return window.brickly!.invoke('list', input) as Promise<PortQueryResult>
  }
  // Mock 逻辑
  await new Promise((resolve) => setTimeout(resolve, 250))
  let filtered = MOCK_ROWS.rows
  if (input.protocol !== 'all') {
    filtered = filtered.filter((r) => r.protocol === input.protocol)
  }
  if (!input.includeEstablished) {
    filtered = filtered.filter((r) => r.state.toUpperCase().includes('LISTEN'))
  }
  if (input.query.trim()) {
    const q = input.query.toLowerCase()
    filtered = filtered.filter(
      (r) =>
        String(r.localPort).includes(q) ||
        (r.pid && String(r.pid).includes(q)) ||
        (r.processName && r.processName.toLowerCase().includes(q))
    )
  }
  return {
    ...MOCK_ROWS,
    query: input.query,
    protocol: input.protocol,
    count: filtered.length,
    rows: filtered.slice(0, input.limit),
    generatedAt: new Date().toISOString()
  }
}

/** 结束指定 PID 的进程 */
export async function killProcess(pid: number, force: boolean): Promise<KillProcessResult> {
  if (hasBrickly()) {
    return window.brickly!.invoke('kill', { pid, force }) as Promise<KillProcessResult>
  }
  await new Promise((resolve) => setTimeout(resolve, 300))
  const target = MOCK_ROWS.rows.find((r) => r.pid === pid)
  return {
    ok: true,
    pid,
    force,
    method: 'api',
    processName: target?.processName || 'mock-process',
    platform: 'windows',
    killedAt: new Date().toISOString()
  }
}

/** 获取进程详细属性 */
export async function getProcessDetails(pid: number): Promise<ProcessDetails> {
  if (hasBrickly()) {
    return window.brickly!.invoke('details', { pid }) as Promise<ProcessDetails>
  }
  await new Promise((resolve) => setTimeout(resolve, 200))
  const target = MOCK_ROWS.rows.find((r) => r.pid === pid)
  return {
    ok: true,
    platform: 'windows',
    pid,
    parentPid: 1024,
    processName: target?.processName || 'node.exe',
    executablePath: target?.executablePath || 'C:\\Program Files\\nodejs\\node.exe',
    commandLine: target ? `"${target.executablePath}" --port ${target.localPort}` : 'node index.js',
    workingDirectory: 'D:\\brick-project\\example-bricks\\com.brickly.port-inspector',
    user: 'NT AUTHORITY\\SYSTEM',
    state: target?.state || 'Running',
    startedAt: new Date(Date.now() - 3600000).toLocaleString(),
    elapsed: '01:00:15',
    inspectedAt: new Date().toISOString()
  }
}

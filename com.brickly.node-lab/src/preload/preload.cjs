/**
 * Node Lab — App preload.
 *
 * 运行在宿主 preload chain-load 出来的上下文里，sandbox=false + contextIsolation=true。
 * 这里负责用 contextBridge 把"经过封装 / 审计"的 Node 能力暴露到 window.nodeLab。
 *
 * 原则：
 *   - 永远不要把整个 fs / child_process 直接 expose 出去；只暴露你业务真正需要的函数。
 *   - 所有面向页面的 API 都应是 async，统一 Promise，便于 UI 处理错误。
 *   - 敏感操作建议做参数校验（白名单、路径归一化、超时）。
 */

const { contextBridge } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const dns = require('node:dns/promises')
const { exec } = require('node:child_process')
const { promisify } = require('node:util')
const { performance } = require('node:perf_hooks')

const execAsync = promisify(exec)

// ——— 文件系统 ———

async function statPath(absPath) {
  const s = await fs.stat(absPath)
  return {
    type: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other',
    size: s.size,
    modified: s.mtime.toISOString(),
    mode: '0o' + (s.mode & 0o777).toString(8)
  }
}

async function readText(absPath, maxBytes = 1_000_000) {
  if (!path.isAbsolute(absPath)) throw new Error('absPath 必须是绝对路径')
  const s = await fs.stat(absPath)
  if (!s.isFile()) throw new Error('不是普通文件')
  if (s.size > maxBytes) throw new Error(`文件过大: ${s.size} 字节 > 上限 ${maxBytes}`)
  return await fs.readFile(absPath, 'utf8')
}

async function writeText(absPath, content) {
  if (!path.isAbsolute(absPath)) throw new Error('absPath 必须是绝对路径')
  await fs.writeFile(absPath, content, 'utf8')
  return { ok: true, bytes: Buffer.byteLength(content, 'utf8') }
}

async function listDir(absPath) {
  if (!path.isAbsolute(absPath)) throw new Error('absPath 必须是绝对路径')
  const names = await fs.readdir(absPath)
  const items = await Promise.all(
    names.slice(0, 500).map(async (n) => {
      try {
        const full = path.join(absPath, n)
        const s = await fs.stat(full)
        return {
          name: n,
          type: s.isDirectory() ? 'dir' : 'file',
          size: s.isFile() ? s.size : undefined,
          modified: s.mtime.toISOString()
        }
      } catch {
        return { name: n, type: 'error' }
      }
    })
  )
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { count: names.length, truncated: names.length > 500, items }
}

// ——— HTTP（利用 Electron 38 / Node 的全局 fetch，避免 CORS） ———

async function httpRequest({ url, method = 'GET', headers = {}, body }) {
  if (typeof url !== 'string') throw new Error('url 必须是字符串')
  const t0 = performance.now()
  const resp = await fetch(url, {
    method,
    headers,
    body: body && method !== 'GET' ? body : undefined
  })
  const text = await resp.text()
  const t1 = performance.now()
  const responseHeaders = {}
  resp.headers.forEach((v, k) => (responseHeaders[k] = v))
  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: responseHeaders,
    body: text.length > 200_000 ? text.slice(0, 200_000) + '\n...(truncated)' : text,
    durationMs: Math.round(t1 - t0)
  }
}

// ——— Shell ———

async function runShell(command, { cwd, timeoutMs = 10_000 } = {}) {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error('command 必须是非空字符串')
  }
  const t0 = performance.now()
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 5 * 1024 * 1024
    })
    return {
      code: 0,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      durationMs: Math.round(performance.now() - t0)
    }
  } catch (err) {
    return {
      code: err.code ?? -1,
      stdout: err.stdout?.toString() ?? '',
      stderr: (err.stderr?.toString() ?? '') + '\n' + (err.message ?? ''),
      durationMs: Math.round(performance.now() - t0)
    }
  }
}

// ——— 系统 / 环境 ———

function systemInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    v8Version: process.versions.v8,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    hostname: os.hostname(),
    username: os.userInfo().username,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    uptimeSec: Math.round(os.uptime()),
    loadavg: os.loadavg()
  }
}

function envVars(filter) {
  const all = { ...process.env }
  if (!filter) return all
  const needle = String(filter).toLowerCase()
  return Object.fromEntries(
    Object.entries(all).filter(
      ([k, v]) => k.toLowerCase().includes(needle) || String(v).toLowerCase().includes(needle)
    )
  )
}

// ——— DNS ———

async function dnsLookup(host) {
  if (typeof host !== 'string') throw new Error('host 必须是字符串')
  const t0 = performance.now()
  const [addrs4, addrs6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)])
  return {
    host,
    ipv4: addrs4.status === 'fulfilled' ? addrs4.value : [],
    ipv6: addrs6.status === 'fulfilled' ? addrs6.value : [],
    durationMs: Math.round(performance.now() - t0)
  }
}

// ——— 暴露 ———

contextBridge.exposeInMainWorld('nodeLab', {
  fs: { stat: statPath, readText, writeText, listDir },
  net: { http: httpRequest, dns: dnsLookup },
  shell: { run: runShell },
  sys: { info: systemInfo, env: envVars },
  paths: {
    home: () => os.homedir(),
    tmp: () => os.tmpdir(),
    cwd: () => process.cwd(),
    join: (...parts) => path.join(...parts)
  }
})

console.info('[node-lab][preload] window.nodeLab ready')

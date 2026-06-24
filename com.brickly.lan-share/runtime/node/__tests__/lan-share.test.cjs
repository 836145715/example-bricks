'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { resolveWithinRoot } = require('../services/safe-path.cjs')
const { isPrivateIPv4, buildAccessUrls } = require('../services/network.cjs')
const { lookupMime } = require('../services/mime.cjs')
const { formatBytes } = require('../services/format.cjs')
const { FileServer, parseRange, sanitizeFileName } = require('../services/file-server.cjs')
const { ShareService, normalizeConfig } = require('../services/share-service.cjs')

test('resolveWithinRoot 限制在根目录内', () => {
  const root = path.resolve('/srv/share')
  assert.equal(resolveWithinRoot(root, '/a/b.txt').ok, true)
  assert.equal(resolveWithinRoot(root, '/a/b.txt').relativePath, 'a/b.txt')
  assert.equal(resolveWithinRoot(root, '/').relativePath, '')
})

test('resolveWithinRoot 将穿越路径夹紧在根目录内', () => {
  // 绝对路径规范化会把开头的 `..` 夹紧到根目录，最终始终落在共享根内。
  const root = path.resolve('/srv/share')
  const withSep = root.endsWith(path.sep) ? root : root + path.sep
  for (const input of ['/../etc/passwd', '/a/../../secret', '/%2e%2e/%2e%2e/etc']) {
    const result = resolveWithinRoot(root, input)
    assert.equal(result.ok, true)
    assert.ok(result.absolutePath === root || result.absolutePath.startsWith(withSep), input)
  }
})

test('resolveWithinRoot 拒绝非法编码与空字节', () => {
  const root = path.resolve('/srv/share')
  assert.equal(resolveWithinRoot(root, '/%E0%A4%A').ok, false)
  assert.equal(resolveWithinRoot(root, '/a%00b').ok, false)
})

test('isPrivateIPv4 识别内网网段', () => {
  assert.equal(isPrivateIPv4('192.168.1.10'), true)
  assert.equal(isPrivateIPv4('10.0.0.5'), true)
  assert.equal(isPrivateIPv4('172.16.3.4'), true)
  assert.equal(isPrivateIPv4('8.8.8.8'), false)
  assert.equal(isPrivateIPv4('not-an-ip'), false)
})

test('buildAccessUrls 始终包含回环地址', () => {
  const urls = buildAccessUrls(8723)
  assert.ok(urls.some((item) => item.url === 'http://127.0.0.1:8723/'))
})

test('lookupMime 已知与未知扩展名', () => {
  assert.equal(lookupMime('a.png'), 'image/png')
  assert.equal(lookupMime('a.unknownext'), 'application/octet-stream')
})

test('formatBytes 单位换算', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
})

test('parseRange 解析与边界', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 })
  assert.deepEqual(parseRange('bytes=-50', 1000), { start: 950, end: 999 })
  assert.equal(parseRange('bytes=2000-3000', 1000), 'invalid')
  assert.equal(parseRange(undefined, 1000), null)
})

test('sanitizeFileName 去除路径与非法字符', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd')
  assert.equal(sanitizeFileName('a/b\\c.txt'), 'c.txt')
  assert.equal(sanitizeFileName('正常 文件.zip'), '正常 文件.zip')
})

test('normalizeConfig 端口与字段归一化', () => {
  const c = normalizeConfig({ root: '  /tmp  ', port: 70000, allowUpload: 'x', accessCode: ' ab ' })
  assert.equal(c.root, '/tmp')
  assert.equal(c.port, 8723) // 越界端口回退默认
  assert.equal(c.allowUpload, true)
  assert.equal(c.accessCode, 'ab')
})

async function makeTempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('FileServer 浏览/下载/Range/上传/鉴权 集成', async (t) => {
  const root = await makeTempDir('lan-share-root-')
  await fsp.writeFile(path.join(root, 'hello.txt'), 'hello world', 'utf8')
  await fsp.mkdir(path.join(root, 'sub'))
  await fsp.writeFile(path.join(root, 'sub', 'inner.txt'), 'inner', 'utf8')

  const logs = []
  const server = new FileServer({
    root,
    port: 0,
    allowUpload: true,
    accessCode: '',
    onLog: (entry) => logs.push(entry)
  })
  // 端口 0 让系统分配，再读取真实端口。
  const realServer = await startOnEphemeral(server)
  const port = realServer.address().port
  const base = `http://127.0.0.1:${port}`

  t.after(async () => {
    await server.stop()
    await fsp.rm(root, { recursive: true, force: true })
  })

  // 目录列表
  const listRes = await fetch(`${base}/`)
  assert.equal(listRes.status, 200)
  const listHtml = await listRes.text()
  assert.match(listHtml, /hello\.txt/)
  assert.match(listHtml, /sub/)

  // 下载文件
  const fileRes = await fetch(`${base}/hello.txt`)
  assert.equal(fileRes.status, 200)
  assert.equal(await fileRes.text(), 'hello world')

  // Range 请求
  const rangeRes = await fetch(`${base}/hello.txt`, { headers: { Range: 'bytes=0-4' } })
  assert.equal(rangeRes.status, 206)
  assert.equal(await rangeRes.text(), 'hello')

  // 目录穿越被拒
  const escapeRes = await fetch(`${base}/..%2f..%2fetc`)
  assert.ok(escapeRes.status === 400 || escapeRes.status === 404)

  // 上传
  const uploadRes = await fetch(`${base}/__upload?name=up.txt`, {
    method: 'POST',
    body: 'uploaded-content'
  })
  assert.equal(uploadRes.status, 200)
  const saved = await fsp.readFile(path.join(root, 'up.txt'), 'utf8')
  assert.equal(saved, 'uploaded-content')

  assert.ok(logs.length >= 4)
})

test('FileServer 访问码鉴权', async (t) => {
  const root = await makeTempDir('lan-share-auth-')
  await fsp.writeFile(path.join(root, 'a.txt'), 'secret', 'utf8')
  const server = new FileServer({ root, port: 0, accessCode: 'pass123' })
  const realServer = await startOnEphemeral(server)
  const port = realServer.address().port
  const base = `http://127.0.0.1:${port}`

  t.after(async () => {
    await server.stop()
    await fsp.rm(root, { recursive: true, force: true })
  })

  const noAuth = await fetch(`${base}/a.txt`)
  assert.equal(noAuth.status, 401)

  const ok = await fetch(`${base}/a.txt`, {
    headers: { Authorization: `Basic ${Buffer.from('user:pass123').toString('base64')}` }
  })
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), 'secret')
})

test('ShareService 配置持久化与启停', async (t) => {
  const root = await makeTempDir('lan-share-svc-root-')
  const dataDir = await makeTempDir('lan-share-svc-data-')
  await fsp.writeFile(path.join(root, 'f.txt'), 'data', 'utf8')
  const service = new ShareService({ dataDir })
  await service.loadConfig()

  t.after(async () => {
    await service.stop()
    await fsp.rm(root, { recursive: true, force: true })
    await fsp.rm(dataDir, { recursive: true, force: true })
  })

  const status = await service.start({ root, port: 0, allowUpload: false })
  assert.equal(status.running, true)
  // 配置文件应已写盘
  assert.ok(fs.existsSync(path.join(dataDir, 'config.json')))

  const entries = await service.listEntries('')
  assert.ok(entries.entries.some((item) => item.name === 'f.txt'))

  const stopped = await service.stop()
  assert.equal(stopped.running, false)
})

/**
 * 用端口 0 启动 FileServer 并返回底层 http.Server，便于读取系统分配的真实端口。
 * FileServer.start 内部固定绑定 0.0.0.0，端口 0 由系统分配。
 */
async function startOnEphemeral(server) {
  await server.start()
  return server.server
}

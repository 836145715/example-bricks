'use strict'

const assert = require('assert')
const http = require('http')
const { sendHttpRequest, normalizeHeaders, mergeQuery, MAX_BODY_CHARS } = require('./http-client.cjs')

function fail(msg) {
  console.error('FAIL:', msg)
  process.exitCode = 1
}

function ok(cond, msg) {
  try {
    assert.ok(cond, msg)
    console.log('ok -', msg)
  } catch (e) {
    fail(e.message)
  }
}

// --- pure helpers ---
{
  const h = normalizeHeaders([{ name: 'Accept', value: 'application/json' }, { name: '', value: 'x' }])
  ok(h.accept === 'application/json', 'normalizeHeaders array')
  ok(h[''] === undefined, 'skip empty header name')
}

{
  const h2 = normalizeHeaders({ 'X-Token': 'abc' })
  ok(h2['x-token'] === 'abc' || h2['X-Token'] === 'abc' || Object.values(h2).includes('abc'), 'normalizeHeaders object')
}

{
  const url = mergeQuery('https://example.com/path?a=1', [{ name: 'a', value: '2' }, { name: 'b', value: '3' }])
  ok(url.includes('a=2'), 'query overrides same key')
  ok(url.includes('b=3'), 'query adds new key')
}

async function withServer(handler, fn) {
  const server = http.createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

async function main() {
  // invalid method
  try {
    await sendHttpRequest({ method: 'TRACE', url: 'http://127.0.0.1/' })
    fail('should reject TRACE')
  } catch (e) {
    ok(e.code === 'INVALID_INPUT', 'invalid method code')
  }

  // invalid url
  try {
    await sendHttpRequest({ method: 'GET', url: 'ftp://x' })
    fail('should reject ftp')
  } catch (e) {
    ok(e.code === 'INVALID_INPUT', 'invalid url code')
  }

  // success + non-2xx still ok:true
  await withServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Test': '1' })
    res.end('missing')
  }, async (base) => {
    const r = await sendHttpRequest({ method: 'GET', url: base + '/nope' })
    ok(r.ok === true, 'ok means got response')
    ok(r.status === 404, 'status 404')
    ok(r.body === 'missing', 'body')
    ok(r.headers['x-test'] === '1' || r.headers['X-Test'] === '1', 'headers lowercased preferred')
    ok(typeof r.durationMs === 'number' && r.durationMs >= 0, 'duration')
  })

  // POST body + query
  await withServer((req, res) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ method: req.method, url: req.url, data }))
    })
  }, async (base) => {
    const r = await sendHttpRequest({
      method: 'POST',
      url: base + '/echo',
      query: { q: '1' },
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}'
    })
    ok(r.status === 200, 'post 200')
    const parsed = JSON.parse(r.body)
    ok(parsed.url.includes('q=1'), 'query merged')
    ok(parsed.data === '{"a":1}', 'body sent')
  })

  // timeout
  await withServer((req, res) => {
    setTimeout(() => { res.end('late') }, 500)
  }, async (base) => {
    try {
      await sendHttpRequest({ method: 'GET', url: base + '/', timeoutMs: 50 })
      fail('should timeout')
    } catch (e) {
      ok(e.code === 'TIMEOUT', 'timeout code')
    }
  })

  // truncation
  await withServer((req, res) => {
    res.end('x'.repeat(MAX_BODY_CHARS + 100))
  }, async (base) => {
    const r = await sendHttpRequest({ method: 'GET', url: base + '/' })
    ok(r.truncated === true, 'truncated flag')
    ok(r.body.length === MAX_BODY_CHARS, 'body truncated length')
    ok(r.bodySize === MAX_BODY_CHARS + 100, 'bodySize original')
  })

  if (process.exitCode) {
    console.error('Some tests failed')
    process.exit(1)
  }
  console.log('All http-client tests passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

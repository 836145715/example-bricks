const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const exe = path.resolve(__dirname, '..', '..', 'bin', 'win-x64', 'brick.exe')
const child = spawn(exe, [], { cwd: path.resolve(__dirname, '..', '..') })

let buffer = ''
const pending = new Map()

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

function waitFor(id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${id}`)), 5000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
  })
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.type === 'runtime.ready') {
      send({ type: 'command.invoke', id: 'health-1', commandId: 'health', input: {} })
      continue
    }
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      waiter(message)
    }
  }
})

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk)
})

async function main() {
  send({ type: 'host.hello', protocolVersion: '0.2.0' })
  const health = await waitFor('health-1')
  console.log(JSON.stringify(health.result || health.error, null, 2))
  const sample = path.join(os.tmpdir(), 'brickly-local-search-preview-smoke.txt')
  fs.writeFileSync(sample, 'local search preview smoke\n', 'utf8')
  send({ type: 'command.invoke', id: 'preview-1', commandId: 'preview', input: { path: sample } })
  const preview = await waitFor('preview-1')
  console.log(JSON.stringify(preview.result || preview.error, null, 2))
  send({ type: 'runtime.shutdown' })
}

main()
  .catch((error) => {
    console.error(error)
    child.kill()
    process.exitCode = 1
  })

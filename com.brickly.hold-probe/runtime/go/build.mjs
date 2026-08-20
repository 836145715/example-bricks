import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const sourceDir = dirname(fileURLToPath(import.meta.url))
const brickRoot = join(sourceDir, '..', '..')
const targets = {
  'win-x64': { goos: 'windows', goarch: 'amd64', suffix: '.exe' },
  'win-arm64': { goos: 'windows', goarch: 'arm64', suffix: '.exe' },
  'mac-x64': { goos: 'darwin', goarch: 'amd64', suffix: '' },
  'mac-arm64': { goos: 'darwin', goarch: 'arm64', suffix: '' }
}

const requested = process.argv.slice(2).flatMap((value) => value.split(',')).filter(Boolean)
const defaults = process.platform === 'darwin'
  ? [process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64']
  : [process.arch === 'arm64' ? 'win-arm64' : 'win-x64']

for (const key of requested.length > 0 ? requested : defaults) {
  const target = targets[key]
  if (!target) throw new Error(`Unknown target: ${key}`)
  const output = join(brickRoot, 'runtime', key, `brick${target.suffix}`)
  mkdirSync(dirname(output), { recursive: true })
  console.log(`Building ${key} -> ${output}`)
  const result = spawnSync(
    'go',
    ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'],
    {
      cwd: sourceDir,
      env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: '0' },
      stdio: 'inherit'
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

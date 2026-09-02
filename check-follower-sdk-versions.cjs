const { readdirSync, readFileSync, statSync } = require('node:fs')
const { join, relative } = require('node:path')

const root = __dirname
const pin = JSON.parse(readFileSync(join(root, 'sdk-pin.json'), 'utf8'))
const goModule = 'github.com/836145715/brickly-sdk-go'
const goVersion = `v${pin.version}`
const pythonRequirement = `brickly-sdk==${pin.version}`
const nodeSpec = `^${pin.version}`
const protocolVersion = pin.protocol
const protocolVersionPattern = /protocolVersion\s*[=:]\s*['"]([^'"]+)['"]/g
const failures = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === '.venv' || name === '.worktrees') continue

    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path)
      continue
    }

    const inspectProtocol = /\.(go|cjs|js|ts|py)$/.test(name) && !/smoke/i.test(name)
    const inspectSdkPin = ['go.mod', 'pyproject.toml', 'requirements.txt', 'manifest.json', 'package.json'].includes(
      name
    )
    if (!inspectProtocol && !inspectSdkPin) continue

    const content = readFileSync(path, 'utf8')
    const displayPath = relative(root, path)

    if (inspectProtocol) {
      for (const match of content.matchAll(protocolVersionPattern)) {
        if (match[1] !== protocolVersion) {
          failures.push(`${displayPath} must use protocolVersion ${protocolVersion}, found ${match[1]}`)
        }
      }
    }

    if (!inspectSdkPin) continue

    if (name === 'package.json') {
      let pkg
      try {
        pkg = JSON.parse(content)
      } catch {
        failures.push(`${displayPath} is not valid JSON`)
        continue
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      for (const key of ['@syllm/brickly-sdk', '@syllm/brickly-ui']) {
        if (deps[key] && deps[key] !== nodeSpec) {
          failures.push(`${displayPath} ${key} must be ${nodeSpec}, found ${deps[key]}`)
        }
      }
    }

    if (name === 'go.mod' && content.includes(goModule)) {
      if (!content.includes(`${goModule} ${goVersion}`)) {
        failures.push(`${displayPath} must require ${goModule} ${goVersion}`)
      }
      if (new RegExp(`^replace\\s+${goModule.replaceAll('.', '\\.')}`, 'm').test(content)) {
        failures.push(`${displayPath} must use the published Go SDK without replace`)
      }
    }

    if (name === 'requirements.txt' && content.includes('brickly-sdk')) {
      const sdkLines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('brickly-sdk'))
      if (sdkLines.length !== 1 || sdkLines[0] !== pythonRequirement) {
        failures.push(`${displayPath} must contain exactly ${pythonRequirement}`)
      }
    }

    if (name === 'pyproject.toml' && content.includes('brickly-sdk')) {
      const sdkSpecs = [...content.matchAll(/"(brickly-sdk[^"]*)"/g)].map((match) => match[1])
      if (sdkSpecs.length !== 1 || sdkSpecs[0] !== pythonRequirement) {
        failures.push(`${displayPath} must contain exactly ${pythonRequirement}`)
      }
    }

    if (name === 'manifest.json' && content.includes('brickly-sdk==')) {
      const sdkSpecs = [...content.matchAll(/"(brickly-sdk==[^"]+)"/g)].map((match) => match[1])
      if (sdkSpecs.some((spec) => spec !== pythonRequirement)) {
        failures.push(`${displayPath} must only reference ${pythonRequirement}`)
      }
    }
  }
}

walk(root)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`OK: example SDK is ${pin.version}, protocol is ${protocolVersion}`)

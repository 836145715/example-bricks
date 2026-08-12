const { readdirSync, readFileSync, statSync } = require('node:fs')
const { join, relative } = require('node:path')

const root = __dirname
const goModule = 'github.com/836145715/brickly-sdk-go'
const goVersion = 'v0.3.1'
const pythonRequirement = 'brickly-sdk==0.3.1'
const failures = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === '.worktrees') continue

    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path)
      continue
    }

    if (!['go.mod', 'requirements.txt', 'manifest.json'].includes(name)) continue

    const content = readFileSync(path, 'utf8')
    const displayPath = relative(root, path)

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

console.log(`OK: example Go SDK is ${goVersion} and Python SDK is 0.3.1`)

import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const uiPackage = join(repoRoot, 'com.brickly.resource-lab', 'src', 'ui', 'package.json')
const require = createRequire(pathToFileURL(uiPackage))
const Ajv2020 = require('ajv/dist/2020').default
const schema = JSON.parse(await readFile(join(repoRoot, 'specs', 'manifest.schema.json'), 'utf8'))
const entries = await readdir(repoRoot, { withFileTypes: true })
const manifests = []
for (const entry of entries) {
  if (!entry.isDirectory() || (!entry.name.startsWith('com.') && !entry.name.startsWith('io.'))) continue
  const relativePath = `${entry.name}/manifest.json`
  try {
    await access(join(repoRoot, relativePath))
    manifests.push(relativePath)
  } catch {
    // Some example source directories are not standalone Bricks.
  }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function validateRuntimeContract(manifest) {
  const errors = []
  const runtime = manifest.runtime
  if (!runtime) return errors

  // src/out 契约：作者不写 entry/include；entry 由 type+platforms 归一化合成
  if (runtime.entry) errors.push('runtime.entry 为制品字段，作者侧不应声明')
  if (runtime.include) errors.push('runtime.include 已删除，不应声明')
  if (!Array.isArray(runtime.platforms) || runtime.platforms.length === 0) {
    errors.push('runtime.platforms 缺失或为空')
  }
  return errors
}

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
const validate = ajv.compile(schema)
let failed = false

for (const relativePath of manifests) {
  const manifest = JSON.parse(await readFile(join(repoRoot, relativePath), 'utf8'))
  const errors = []
  if (!validate(manifest)) {
    errors.push(...(validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`))
  }
  errors.push(...validateRuntimeContract(manifest))

  if (manifest.runtime?.type === 'python') {
    const manifestDir = dirname(join(repoRoot, relativePath))
    for (const dependencyFile of ['pyproject.toml', 'uv.lock', 'main.py']) {
      if (!(await pathExists(join(manifestDir, 'src', 'runtime', dependencyFile)))) {
        errors.push(`src/runtime is missing ${dependencyFile}`)
      }
    }
  }

  if (errors.length === 0) {
    console.log(`PASS ${relativePath}`)
  } else {
    failed = true
    console.error(`FAIL ${relativePath}`)
    for (const error of errors) console.error(`  ${error}`)
  }
}

if (failed) process.exitCode = 1

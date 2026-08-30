import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const uiPackage = join(repoRoot, 'com.brickly.resource-lab', 'package.json')
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

  const platforms = [...runtime.platforms].sort()
  const entryPlatforms = Object.keys(runtime.entry).sort()
  if (JSON.stringify(platforms) !== JSON.stringify(entryPlatforms)) {
    errors.push('runtime.entry keys must exactly match runtime.platforms')
  }
  for (const [platform, entry] of Object.entries(runtime.entry)) {
    if (!entry.startsWith(`runtime/${platform}/`)) {
      errors.push(`runtime.entry[${platform}] must be inside runtime/${platform}/`)
    }
  }
  for (const include of runtime.include ?? []) {
    if (!runtime.platforms.includes(include.platform)) {
      errors.push(`runtime.include platform is not declared: ${include.platform}`)
    }
    if (!include.path.startsWith(`runtime/${include.platform}/`)) {
      errors.push(`runtime.include path must be inside runtime/${include.platform}/: ${include.path}`)
    }
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
    for (const [platform, entry] of Object.entries(manifest.runtime.entry)) {
      if (!(await pathExists(join(manifestDir, entry)))) continue
      for (const dependencyFile of ['pyproject.toml', 'uv.lock']) {
        if (!(await pathExists(join(manifestDir, `runtime/${platform}/${dependencyFile}`)))) {
          errors.push(`${platform} runtime is missing ${dependencyFile}`)
        }
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

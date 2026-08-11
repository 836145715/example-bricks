import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const uiPackage = join(repoRoot, 'com.brickly.resource-lab', 'package.json')
const require = createRequire(pathToFileURL(uiPackage))
const Ajv2020 = require('ajv/dist/2020').default
const schema = JSON.parse(await readFile(join(repoRoot, 'specs', 'manifest.schema.json'), 'utf8'))
const manifests = [
  'com.brickly.resource-lab/manifest.json',
  'com.brickly.resource-echo-node/manifest.json',
  'com.brickly.resource-echo-python/manifest.json',
  'com.brickly.resource-echo-go/manifest.json'
]

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
const validate = ajv.compile(schema)
let failed = false

for (const relativePath of manifests) {
  const manifest = JSON.parse(await readFile(join(repoRoot, relativePath), 'utf8'))
  if (validate(manifest)) {
    console.log(`PASS ${relativePath}`)
    continue
  }
  failed = true
  console.error(`FAIL ${relativePath}`)
  for (const error of validate.errors ?? []) {
    console.error(`  ${error.instancePath || '/'} ${error.message}`)
  }
}

if (failed) process.exitCode = 1

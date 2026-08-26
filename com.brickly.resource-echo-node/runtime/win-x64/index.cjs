'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')
const { HoldRegistry } = require('./hold-registry.cjs')
const { createPatternSource, inspectResource, requireSize, transformSource } = require('./operations.cjs')
const { getInputResourceRef, openInputResource } = require('./resource-input.cjs')

const BRICK_ID = 'com.brickly.resource-echo-node'
const brick = new BricklyRuntime({ brickId: BRICK_ID })
let lastEvent
const holds = new HoldRegistry()

brick.onCommand('inspect', (_ctx, input) => inspectResource(openInputResource(brick.resources, input)))

brick.onCommand('produce', async (_ctx, input) => {
  const sizeBytes = requireSize(input?.sizeBytes)
  return brick.resources.createFrom(createPatternSource(sizeBytes, input?.chunkBytes, input?.byte), {
    expectedSizeBytes: sizeBytes,
    mimeType: input?.mimeType ?? 'application/octet-stream',
    name: input?.name ?? `node-${sizeBytes}.bin`,
    ...(input?.ttlMs === undefined ? {} : { ttlMs: input.ttlMs })
  })
})

brick.onCommand('transform', async (_ctx, input) => {
  const resource = openInputResource(brick.resources, input)
  return brick.resources.createFrom(transformSource(resource, input?.mask), {
    expectedSizeBytes: resource.ref.sizeBytes,
    mimeType: resource.ref.mimeType,
    name: `node-transformed-${resource.ref.name ?? 'resource.bin'}`
  })
})

brick.onCommand('relay', (ctx, input) => {
  const resource = getInputResourceRef(input)
  const targetAlias = String(input?.targetAlias ?? '')
  if (!targetAlias) throw invalidInput('targetAlias')
  return ctx.dependencies.require(targetAlias).invoke(input?.targetCommandId ?? 'inspect', {
    resource,
    ...(input?.targetInput && typeof input.targetInput === 'object' ? input.targetInput : {})
  })
})

brick.onCommand('hold', async (ctx, input) => {
  const operationId = String(input?.operationId ?? ctx.requestId)
  const signal = holds.begin(operationId)
  ctx.onCancel(() => holds.cancel(operationId))
  try {
    return await inspectResource(openInputResource(brick.resources, input), 'node', Number(input?.delayMs ?? 25), signal)
  } finally {
    holds.end(operationId)
  }
})

brick.onCommand('cancel-hold', (_ctx, input) => ({
  operationId: String(input?.operationId ?? ''),
  cancelled: holds.cancel(String(input?.operationId ?? ''))
}))

brick.onCommand('event-last', () => lastEvent)

brick.events.on('resource-lab:probe', (payload) => {
  void (async () => {
    const envelope = envelopeFromPlain(payload)
    const resourceRef = envelope?.resource
    lastEvent = resourceRef && typeof resourceRef === 'object'
      ? { ...(await inspectResource(brick.resources.open(resourceRef))), received: true, probeId: envelope?.probeId }
      : { runtime: 'node', received: true, probeId: envelope?.probeId }
  })().catch((error) => {
    lastEvent = { runtime: 'node', errorCode: error?.code ?? 'INTERNAL_ERROR' }
  })
})

function envelopeFromPlain(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  throw invalidInput('event payload')
}

function invalidInput(name) {
  const error = new Error(`${name} is required`)
  error.code = 'INVALID_INPUT'
  return error
}

brick.start()

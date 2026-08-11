'use strict'

const { BricklyRuntime, ResourceHandle } = require('@syllm/brickly-sdk')
const { HoldRegistry } = require('./hold-registry.cjs')
const { createPatternSource, inspectResource, requireSize, transformSource } = require('./operations.cjs')

const BRICK_ID = 'com.brickly.resource-echo-node'
const brick = new BricklyRuntime({ brickId: BRICK_ID })
let lastEvent
const holds = new HoldRegistry()

brick.onCommand('inspect', (_ctx, input) => inspectResource(requireResource(input)))

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
  const resource = requireResource(input)
  return brick.resources.createFrom(transformSource(resource, input?.mask), {
    expectedSizeBytes: resource.ref.sizeBytes,
    mimeType: resource.ref.mimeType,
    name: `node-transformed-${resource.ref.name ?? 'resource.bin'}`
  })
})

brick.onCommand('relay', (ctx, input) => {
  const resource = requireResource(input)
  const targetBrickId = String(input?.targetBrickId ?? '')
  if (!targetBrickId) throw invalidInput('targetBrickId')
  return ctx.invoke(targetBrickId, input?.targetCommandId ?? 'inspect', {
    resource,
    ...(input?.targetInput && typeof input.targetInput === 'object' ? input.targetInput : {})
  })
})

brick.onCommand('hold', async (ctx, input) => {
  const operationId = String(input?.operationId ?? ctx.requestId)
  const signal = holds.begin(operationId)
  ctx.onCancel(() => holds.cancel(operationId))
  try {
    return await inspectResource(requireResource(input), 'node', Number(input?.delayMs ?? 25), signal)
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
    if (!(payload instanceof ResourceHandle)) throw invalidInput('event payload')
    const envelope = await payload.json()
    const resource = envelope?.resource
    lastEvent = resource instanceof ResourceHandle
      ? { ...(await inspectResource(resource)), received: true, probeId: envelope?.probeId }
      : { runtime: 'node', received: true, probeId: envelope?.probeId }
  })().catch((error) => {
    lastEvent = { runtime: 'node', errorCode: error?.code ?? 'INTERNAL_ERROR' }
  })
})

function requireResource(input) {
  if (!(input?.resource instanceof ResourceHandle)) throw invalidInput('resource')
  return input.resource
}

function invalidInput(name) {
  const error = new Error(`${name} is required`)
  error.code = 'INVALID_INPUT'
  return error
}

brick.start()

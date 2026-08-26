'use strict'

function openInputResource(resources, input) {
  const resource = input?.resource
  if (isResourceHandle(resource)) return resource
  return resources.open(getInputResourceRef(input))
}

function getInputResourceRef(input) {
  const resource = input?.resource
  if (isResourceHandle(resource) && isResourceRef(resource.ref)) return resource.ref
  if (!isResourceRef(resource) && !isPlainResource(resource)) throw invalidInput('resource')
  return resource
}

function openEventPayload(resources, payload) {
  if (isResourceHandle(payload)) return payload
  if (payload && payload.encoding === 'json' && payload.resource) {
    return resources.open(payload.resource)
  }
  throw invalidInput('event payload')
}

function isResourceHandle(value) {
  return Boolean(value && typeof value === 'object' && typeof value.stream === 'function')
}

function isResourceRef(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.kind === 'brickly.resource' &&
    typeof value.resourceId === 'string'
  )
}

function isPlainResource(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function invalidInput(name) {
  const error = new Error(`${name} is required`)
  error.code = 'INVALID_INPUT'
  return error
}

module.exports = { getInputResourceRef, openEventPayload, openInputResource }

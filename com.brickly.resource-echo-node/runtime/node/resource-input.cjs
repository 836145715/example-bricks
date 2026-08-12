'use strict'

function openInputResource(resources, input) {
  return resources.open(getInputResourceRef(input))
}

function getInputResourceRef(input) {
  const ref = input?.resource
  if (!ref || typeof ref !== 'object') throw invalidInput('resource')
  return ref
}

function invalidInput(name) {
  const error = new Error(`${name} is required`)
  error.code = 'INVALID_INPUT'
  return error
}

module.exports = { getInputResourceRef, openInputResource }

/* eslint-disable */
'use strict'

const BRICK_ID = 'com.brickly.env-test'
const PROTOCOL_VERSION = '0.1.0'
const ENV_KEYS = [
  'ENV_TEST_ONLY',
  'ENV_TEST_FIELD_ONLY',
  'ENV_TEST_BOTH',
  'ENV_TEST_DEFAULT',
  'ENV_TEST_SECRET',
  'ENV_TEST_OVERRIDE',
  'ENV_TEST_PROFILE_SECRET'
]

let buffer = ''
let helloConfig = {}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function pickEnv() {
  const out = {}
  for (const key of ENV_KEYS) {
    out[key] = process.env[key] ?? null
  }
  return out
}

function mask(value) {
  if (value === null || value === undefined || value === '') return value ?? null
  return '******'
}

function inspect() {
  const env = pickEnv()
  const publicEnv = {
    ...env,
    ENV_TEST_SECRET: mask(env.ENV_TEST_SECRET),
    ENV_TEST_PROFILE_SECRET: mask(env.ENV_TEST_PROFILE_SECRET)
  }
  const configKeys = Object.keys(helloConfig).sort()
  return {
    config: helloConfig,
    env: publicEnv,
    checks: {
      configOnlyInConfig: helloConfig.configOnly !== undefined,
      configOnlyNotInEnv: process.env.ENV_TEST_CONFIG_ONLY === undefined,
      profileEnvOnlyInEnv: Boolean(process.env.ENV_TEST_ONLY),
      profileEnvOnlyNotInConfig: helloConfig.ENV_TEST_ONLY === undefined,
      fieldEnvOnlyInEnv: Boolean(process.env.ENV_TEST_FIELD_ONLY),
      fieldEnvOnlyNotInConfig: helloConfig.fieldEnvOnly === undefined,
      bothInConfig: helloConfig.bothValue !== undefined,
      bothInEnv: Boolean(process.env.ENV_TEST_BOTH),
      defaultEnvInEnv: process.env.ENV_TEST_DEFAULT === 'from-default',
      secretInEnv: Boolean(process.env.ENV_TEST_SECRET),
      secretNotInConfig: helloConfig.secretToken === undefined,
      profileOverrideWins: process.env.ENV_TEST_OVERRIDE === 'from-profile-default',
      profileSecretInEnv: Boolean(process.env.ENV_TEST_PROFILE_SECRET),
      profileSecretNotInConfig: helloConfig.ENV_TEST_PROFILE_SECRET === undefined,
      configKeys
    }
  }
}

function handleInvoke(message) {
  const { id, commandId } = message
  if (commandId !== 'inspect') {
    send({
      type: 'command.error',
      id,
      error: { code: 'COMMAND_NOT_FOUND', message: `Unknown command: ${commandId}` }
    })
    return
  }
  const result = inspect()
  send({ type: 'command.output', id, name: 'config', value: result.config })
  send({ type: 'command.output', id, name: 'env', value: result.env })
  send({ type: 'command.output', id, name: 'checks', value: result.checks })
  send({ type: 'command.result', id, result })
}

function onMessage(message) {
  if (message.type === 'host.hello') {
    helloConfig = message.config && typeof message.config === 'object' ? message.config : {}
    send({ type: 'runtime.ready', protocolVersion: PROTOCOL_VERSION, brickId: BRICK_ID })
  } else if (message.type === 'runtime.ping') {
    send({ type: 'runtime.pong', id: message.id })
  } else if (message.type === 'command.invoke') {
    handleInvoke(message)
  } else if (message.type === 'runtime.shutdown') {
    send({ type: 'runtime.bye' })
    process.exit(0)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      onMessage(JSON.parse(line))
    } catch (error) {
      send({
        type: 'command.error',
        id: 'unknown',
        error: { code: 'PROTOCOL_ERROR', message: error && error.message ? error.message : String(error) }
      })
    }
  }
})

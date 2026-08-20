/* eslint-disable */
'use strict'

const { BricklyRuntime } = require('@syllm/brickly-sdk')

const BRICK_ID = 'com.brickly.env-test'
const ENV_KEYS = [
  'ENV_TEST_ONLY',
  'ENV_TEST_FIELD_ONLY',
  'ENV_TEST_BOTH',
  'ENV_TEST_DEFAULT',
  'ENV_TEST_SECRET',
  'ENV_TEST_OVERRIDE',
  'ENV_TEST_PROFILE_SECRET'
]

const brick = new BricklyRuntime({ brickId: BRICK_ID })

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

function inspect(config) {
  const env = pickEnv()
  const publicEnv = {
    ...env,
    ENV_TEST_SECRET: mask(env.ENV_TEST_SECRET),
    ENV_TEST_PROFILE_SECRET: mask(env.ENV_TEST_PROFILE_SECRET)
  }
  const configKeys = Object.keys(config).sort()
  return {
    config,
    env: publicEnv,
    checks: {
      configOnlyInConfig: config.configOnly !== undefined,
      configOnlyNotInEnv: process.env.ENV_TEST_CONFIG_ONLY === undefined,
      profileEnvOnlyInEnv: Boolean(process.env.ENV_TEST_ONLY),
      profileEnvOnlyNotInConfig: config.ENV_TEST_ONLY === undefined,
      fieldEnvOnlyInEnv: Boolean(process.env.ENV_TEST_FIELD_ONLY),
      fieldEnvOnlyNotInConfig: config.fieldEnvOnly === undefined,
      bothInConfig: config.bothValue !== undefined,
      bothInEnv: Boolean(process.env.ENV_TEST_BOTH),
      defaultEnvInEnv: process.env.ENV_TEST_DEFAULT === 'from-default',
      secretInEnv: Boolean(process.env.ENV_TEST_SECRET),
      secretNotInConfig: config.secretToken === undefined,
      profileOverrideWins: process.env.ENV_TEST_OVERRIDE === 'from-profile-default',
      profileSecretInEnv: Boolean(process.env.ENV_TEST_PROFILE_SECRET),
      profileSecretNotInConfig: config.ENV_TEST_PROFILE_SECRET === undefined,
      configKeys
    }
  }
}

brick.onCommand('inspect', async (ctx) => {
  const result = inspect(ctx.config || {})
  ctx.output('config', result.config)
  ctx.output('env', result.env)
  ctx.output('checks', result.checks)
  return result
})

brick.start()

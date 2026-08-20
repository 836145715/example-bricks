/* eslint-disable */
'use strict'

function buildHotkeyInput(config = {}) {
  return {
    languageType: stringOrUndefined(config.hotkeyLanguageType),
    probability: Boolean(config.hotkeyProbability),
    outputDir: stringOrUndefined(config.hotkeyOutputDir),
    keepScreenshot: Boolean(config.hotkeyKeepScreenshot)
  }
}

function withHotkeyDefaults(ctx, input) {
  if (ctx.invocation && ctx.invocation.source === 'hotkey') {
    return { ...buildHotkeyInput(ctx.config), ...(input || {}) }
  }
  return input || {}
}

function stringOrUndefined(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

module.exports = {
  buildHotkeyInput,
  withHotkeyDefaults
}

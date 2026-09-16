/* eslint-disable */
'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { buildHotkeyInput, withHotkeyDefaults } = require('../src/hotkey')

test('buildHotkeyInput 使用默认热键命令输入', () => {
  assert.deepEqual(buildHotkeyInput({}), {
    languageType: undefined,
    probability: false,
    outputDir: undefined,
    keepScreenshot: false
  })
})

test('buildHotkeyInput 从 Profile 配置生成命令输入', () => {
  assert.deepEqual(
    buildHotkeyInput({
      hotkeyLanguageType: 'CHN_ENG',
      hotkeyProbability: true,
      hotkeyKeepScreenshot: true,
      hotkeyOutputDir: ' /tmp/ocr '
    }),
    {
      languageType: 'CHN_ENG',
      probability: true,
      outputDir: '/tmp/ocr',
      keepScreenshot: true
    }
  )
})

test('withHotkeyDefaults 只在热键场景合并 Profile 默认输入', () => {
  assert.deepEqual(
    withHotkeyDefaults(
      {
        invocation: { source: 'hotkey' },
        config: {
          hotkeyLanguageType: 'ENG',
          hotkeyProbability: true,
          hotkeyKeepScreenshot: true
        }
      },
      { probability: false }
    ),
    {
      languageType: 'ENG',
      probability: false,
      outputDir: undefined,
      keepScreenshot: true
    }
  )
  assert.deepEqual(
    withHotkeyDefaults(
      {
        invocation: { source: 'unknown' },
        config: { hotkeyLanguageType: 'ENG' }
      },
      { probability: true }
    ),
    { probability: true }
  )
})

'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { escapeXml } = require('../lib/svg-escape')

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeXml('a&b'), 'a&amp;b')
  })

  it('escapes less-than', () => {
    assert.equal(escapeXml('a<b'), 'a&lt;b')
  })

  it('escapes greater-than', () => {
    assert.equal(escapeXml('a>b'), 'a&gt;b')
  })

  it('escapes double quote', () => {
    assert.equal(escapeXml('a"b'), 'a&quot;b')
  })

  it('escapes single quote', () => {
    assert.equal(escapeXml("a'b"), 'a&apos;b')
  })

  it('escapes all special characters together', () => {
    assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;')
  })

  it('leaves plain strings unchanged', () => {
    assert.equal(escapeXml('hello world'), 'hello world')
  })

  it('coerces non-string values', () => {
    assert.equal(escapeXml(42), '42')
  })
})

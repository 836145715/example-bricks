import assert from 'node:assert/strict'
import {
  buildStatusHighlightRules,
  countFindMatches,
  escapeRegExp,
  mergeHighlightRanges,
  parseHighlightKeywordText
} from './highlight.ts'

assert.equal(escapeRegExp('a+b.log?'), 'a\\+b\\.log\\?')

assert.deepEqual(
  mergeHighlightRanges('alpha beta gamma', [[6, 10]], /ta/gi),
  [
    { text: 'alpha ', className: '' },
    { text: 'be', className: 'log-highlight' },
    { text: 'ta', className: 'log-highlight log-find-highlight' },
    { text: ' gamma', className: '' }
  ]
)

assert.deepEqual(
  mergeHighlightRanges('success error warning 成功 异常 告警', [], null),
  [
    { text: 'success', className: 'log-status-success' },
    { text: ' ', className: '' },
    { text: 'error', className: 'log-status-error' },
    { text: ' ', className: '' },
    { text: 'warning', className: 'log-status-warning' },
    { text: ' ', className: '' },
    { text: '成功', className: 'log-status-success' },
    { text: ' ', className: '' },
    { text: '异常', className: 'log-status-error' },
    { text: ' ', className: '' },
    { text: '告警', className: 'log-status-warning' }
  ]
)

assert.deepEqual(parseHighlightKeywordText('(error|exception|错误|失败|error)'), [
  'error',
  'exception',
  '错误',
  '失败'
])

assert.deepEqual(parseHighlightKeywordText('error,exception 错误'), [
  'error,exception 错误'
])

assert.deepEqual(
  mergeHighlightRanges(
    'fatal timeout ready',
    [],
    null,
    buildStatusHighlightRules({
      'status-error': 'fatal|timeout',
      'status-warning': 'pending',
      'status-success': 'ready'
    })
  ),
  [
    { text: 'fatal', className: 'log-status-error' },
    { text: ' ', className: '' },
    { text: 'timeout', className: 'log-status-error' },
    { text: ' ', className: '' },
    { text: 'ready', className: 'log-status-success' }
  ]
)

assert.deepEqual(
  mergeHighlightRanges('error code=500', [[0, 5]], /err/gi),
  [
    { text: 'err', className: 'log-status-error log-highlight log-find-highlight' },
    { text: 'or', className: 'log-status-error log-highlight' },
    { text: ' code=', className: '' },
    { text: '500', className: 'log-status-error' }
  ]
)

assert.deepEqual(
  mergeHighlightRanges('error user=42 success', [[0, 5], [6, 13]], null),
  [
    { text: 'error', className: 'log-status-error log-highlight' },
    { text: ' ', className: '' },
    { text: 'user=42', className: 'log-highlight' },
    { text: ' ', className: '' },
    { text: 'success', className: 'log-status-success' }
  ]
)

assert.deepEqual(
  mergeHighlightRanges('🙂 error 用户=张三', [[3, 8], [9, 14]], null),
  [
    { text: '🙂 ', className: '' },
    { text: 'error', className: 'log-status-error log-highlight' },
    { text: ' ', className: '' },
    { text: '用户=张三', className: 'log-highlight' }
  ]
)

assert.deepEqual(
  mergeHighlightRanges('前缀 错误 后缀', [[3, 5]], null),
  [
    { text: '前缀 ', className: '' },
    { text: '错误', className: 'log-status-error log-highlight' },
    { text: ' 后缀', className: '' }
  ]
)

assert.equal(countFindMatches('error error success', /error/gi), 2)

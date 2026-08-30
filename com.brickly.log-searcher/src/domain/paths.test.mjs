import assert from 'node:assert/strict'
import {
  dateFilterPreset,
  describeDateFilter,
  filterFilesByModifiedDate,
  formatLocalDateKey,
  isDateFilterActive,
  isValidDateKey,
  localDateRangeUnixSeconds,
  normalizeDateFilter
} from './paths.ts'

assert.equal(isValidDateKey('2026-08-30'), true)
assert.equal(isValidDateKey('2026-02-31'), false)
assert.equal(isValidDateKey('08-30'), false)

const noon = new Date(2026, 7, 30, 12, 0, 0, 0)
assert.equal(formatLocalDateKey(noon), '2026-08-30')

const startOfDay = Math.floor(new Date(2026, 7, 30, 0, 0, 0, 0).getTime() / 1000)
const almostEnd = Math.floor(new Date(2026, 7, 30, 23, 59, 59, 0).getTime() / 1000)
const nextMidnight = Math.floor(new Date(2026, 7, 31, 0, 0, 0, 0).getTime() / 1000)
const previousDay = Math.floor(new Date(2026, 7, 29, 18, 0, 0, 0).getTime() / 1000)

const files = [
  { path: '/logs/today-noon.log', modifiedAt: Math.floor(noon.getTime() / 1000) },
  { path: '/logs/today-start.log', modifiedAt: startOfDay },
  { path: '/logs/today-end.log', modifiedAt: almostEnd },
  { path: '/logs/next-day.log', modifiedAt: nextMidnight },
  { path: '/logs/yesterday.log', modifiedAt: previousDay },
  { path: '/logs/no-mtime.log' }
]

assert.deepEqual(
  filterFilesByModifiedDate(files, { mode: 'day', startDate: '2026-08-30', endDate: '' }).map(file => file.path),
  ['/logs/today-noon.log', '/logs/today-start.log', '/logs/today-end.log']
)

assert.deepEqual(
  filterFilesByModifiedDate(files, { mode: 'range', startDate: '2026-08-29', endDate: '2026-08-30' }).map(file => file.path),
  ['/logs/today-noon.log', '/logs/today-start.log', '/logs/today-end.log', '/logs/yesterday.log']
)

assert.deepEqual(
  filterFilesByModifiedDate(files, { mode: 'range', startDate: '2026-08-30', endDate: '2026-08-29' }).map(file => file.path),
  ['/logs/today-noon.log', '/logs/today-start.log', '/logs/today-end.log', '/logs/yesterday.log']
)

assert.deepEqual(
  filterFilesByModifiedDate(files, { mode: 'day', startDate: '', endDate: '' }),
  []
)

const bounds = localDateRangeUnixSeconds('2026-08-30', '2026-08-30')
assert.ok(bounds)
assert.equal(bounds.start, startOfDay)
assert.equal(bounds.endExclusive, nextMidnight)

assert.equal(isDateFilterActive({ mode: 'range', startDate: '2026-08-30', endDate: '' }), false)
assert.equal(isDateFilterActive({ mode: 'day', startDate: '2026-08-30', endDate: '' }), true)

assert.deepEqual(
  normalizeDateFilter({ mode: 'day', startDate: '2026-08-30', endDate: '2026-08-01' }),
  { mode: 'day', startDate: '2026-08-30', endDate: '2026-08-30' }
)

const presetNow = new Date(2026, 7, 30, 16, 0, 0)
assert.deepEqual(dateFilterPreset('today', presetNow), {
  mode: 'day',
  startDate: '2026-08-30',
  endDate: '2026-08-30'
})
assert.deepEqual(dateFilterPreset('yesterday', presetNow), {
  mode: 'day',
  startDate: '2026-08-29',
  endDate: '2026-08-29'
})
assert.deepEqual(dateFilterPreset('last7', presetNow), {
  mode: 'range',
  startDate: '2026-08-24',
  endDate: '2026-08-30'
})

assert.equal(describeDateFilter({ mode: 'day', startDate: '2026-08-30', endDate: '2026-08-30' }), '2026-08-30')
assert.equal(
  describeDateFilter({ mode: 'range', startDate: '2026-08-24', endDate: '2026-08-30' }),
  '2026-08-24 ~ 2026-08-30'
)

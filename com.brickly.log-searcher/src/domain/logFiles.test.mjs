import assert from 'node:assert/strict'
import { getDefaultSelectedFiles, getLogFileName, sortLogFiles } from './logFiles.ts'

assert.equal(getLogFileName('/var/log/nginx/access.log'), 'access.log')
assert.equal(getLogFileName('C:\\logs\\app.log'), 'app.log')

assert.deepEqual(
  sortLogFiles([
    '/logs/app-error-2026-06-07.log',
    '/logs/app-2026-06-06.log',
    '/logs/app.log',
    '/logs/app-2026-06-07.1.log',
    '/logs/app-2026-06-07.log'
  ]),
  [
    '/logs/app.log',
    '/logs/app-2026-06-07.log',
    '/logs/app-2026-06-07.1.log',
    '/logs/app-2026-06-06.log',
    '/logs/app-error-2026-06-07.log'
  ]
)

assert.deepEqual(
  getDefaultSelectedFiles(['/logs/app.log', '/logs/app-1.log'], [
    { path: ' /logs/app.log ', enabled: true },
    { path: '/logs/app-1.log', enabled: false }
  ]),
  ['/logs/app.log']
)

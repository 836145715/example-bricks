import assert from 'node:assert/strict'
import {
  formatLogFileSize,
  getDefaultSelectedFiles,
  getLogFileName,
  isSearchableLogFile,
  normalizeRemoteLogFiles,
  sortLogFiles,
  sortRemoteLogFilesByModifiedAt
} from './logFiles.ts'

assert.equal(getLogFileName('/var/log/nginx/access.log'), 'access.log')
assert.equal(getLogFileName('C:\\logs\\app.log'), 'app.log')
assert.equal(formatLogFileSize(0), '0 B')
assert.equal(formatLogFileSize(1024), '1 KB')
assert.equal(formatLogFileSize(1572864), '1.5 MB')

assert.deepEqual(
  normalizeRemoteLogFiles({
    files: ['/logs/app.log'],
    fileInfos: [{ path: '/logs/app.log', sizeBytes: 1048576 }]
  }),
  [{ path: '/logs/app.log', sizeBytes: 1048576 }]
)

assert.equal(isSearchableLogFile({ path: '/logs/app.log', mimeType: 'text/plain' }), true)
assert.equal(isSearchableLogFile({ path: '/srv/service.jar', mimeType: 'application/zip' }), false)
assert.equal(isSearchableLogFile({ path: '/srv/image.png', mimeType: 'image/png' }), false)

assert.deepEqual(
  sortRemoteLogFilesByModifiedAt([
    { path: '/logs/older.log', modifiedAt: 1722230000 },
    { path: '/logs/newer.log', modifiedAt: 1722230100 }
  ]).map(file => file.path),
  ['/logs/newer.log', '/logs/older.log']
)

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

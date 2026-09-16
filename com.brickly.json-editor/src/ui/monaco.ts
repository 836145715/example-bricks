import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { jsonDefaults } from 'monaco-editor/esm/vs/language/json/monaco.contribution'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

type MonacoWorkerLabel = string | undefined

;(globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker(_moduleId: string, label: MonacoWorkerLabel): Worker
  }
}).MonacoEnvironment = {
  getWorker(_moduleId: string, label: MonacoWorkerLabel) {
    if (label === 'json') return new jsonWorker()
    return new editorWorker()
  }
}

loader.config({ monaco })

jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  schemas: [],
  enableSchemaRequest: false,
  schemaRequest: 'warning',
  schemaValidation: 'warning',
  comments: 'error',
  trailingCommas: 'warning'
})

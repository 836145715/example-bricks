/**
 * Monaco 离线装配：webview CSP 不允许外网，worker 走 vite ?worker 本地打包。
 * 只启用 editor + json 两种 worker，JSON 诊断由 manifest.schema.json 驱动。
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
// 只引入 JSON 语言贡献：全量 monaco-editor 会把 80+ 语言全部打进 bundle（OOM + 体积浪费）
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import manifestSchema from '../vendor/manifest.schema.json'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    return new editorWorker()
  }
}

monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  schemas: [
    {
      uri: 'https://brickly.local/manifest.schema.json',
      fileMatch: ['*'],
      schema: manifestSchema as object
    }
  ]
})

export { monaco }

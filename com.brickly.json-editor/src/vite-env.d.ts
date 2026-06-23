/// <reference types="vite/client" />

declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

declare module 'monaco-editor/esm/vs/language/json/monaco.contribution' {
  export const jsonDefaults: {
    setDiagnosticsOptions(options: {
      validate: boolean
      allowComments: boolean
      schemas: unknown[]
      enableSchemaRequest: boolean
      schemaRequest: 'error' | 'warning' | 'ignore'
      schemaValidation: 'error' | 'warning' | 'ignore'
      comments: 'error' | 'warning' | 'ignore'
      trailingCommas: 'error' | 'warning' | 'ignore'
    }): void
  }
}

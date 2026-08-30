import { useMemo, useState } from 'react'

type RunStatus = 'idle' | 'running' | 'success' | 'error'
type ToolDependency = {
  brickId: string
  origin: 'installed' | 'development' | 'review'
  version: string
  note?: string
}
type InputField = {
  name: string
  label?: string
  description?: string
  type: string
  required?: boolean
  default?: unknown
}
type CommandMeta = {
  id: string
  title: string
  description: string
  category: string
  input: Record<string, unknown>
  mode: 'invoke' | 'call' | 'interact'
  fields: InputField[]
}

const runtime: string = "node"
const commands: CommandMeta[] = [
  {
    "id": "hello",
    "title": "Hello World",
    "description": "返回一段最小可运行的问候结果。",
    "category": "example",
    "input": {
      "name": "Brickly"
    },
    "mode": "invoke",
    "fields": [
      {
        "name": "name",
        "label": "名称",
        "type": "string",
        "required": false,
        "default": "Brickly"
      }
    ]
  },
  {
    "id": "analyze-text",
    "title": "文本分析",
    "description": "统计文本字符数、词数、行数，并返回常用转换结果。",
    "category": "text",
    "input": {
      "text": "Hello Brickly"
    },
    "mode": "invoke",
    "fields": [
      {
        "name": "text",
        "label": "文本",
        "type": "string",
        "required": true,
        "default": "Hello Brickly\nBuild something useful."
      }
    ]
  },
  {
    "id": "transform-json",
    "title": "JSON 转换",
    "description": "解析 JSON，返回类型、键列表、格式化文本和紧凑文本。",
    "category": "data",
    "input": {
      "json": "{\"name\":\"Brickly\"}"
    },
    "mode": "invoke",
    "fields": [
      {
        "name": "json",
        "label": "JSON",
        "type": "string",
        "required": true,
        "default": "{\"name\":\"Brickly\",\"kind\":\"tool\"}"
      }
    ]
  },
  {
    "id": "stream-demo",
    "title": "流式输出示例",
    "description": "演示 progress、chunk、output、取消检查和最终 result。",
    "category": "task",
    "input": {
      "topic": "Brickly SDK"
    },
    "mode": "call",
    "fields": [
      {
        "name": "topic",
        "label": "主题",
        "type": "string",
        "required": true,
        "default": "Brickly SDK"
      }
    ]
  },
  {
    "id": "generate-report",
    "title": "生成报告",
    "description": "汇总主题和要点，返回 Markdown 报告。",
    "category": "report",
    "input": {
      "title": "工具报告",
      "notes": "支持 SDK"
    },
    "mode": "invoke",
    "fields": [
      {
        "name": "title",
        "label": "标题",
        "type": "string",
        "required": true,
        "default": "工具报告"
      },
      {
        "name": "notes",
        "label": "要点",
        "type": "string",
        "required": true,
        "default": "支持 SDK\n支持 UI\n支持调用其它工具"
      }
    ]
  }
]
const toolDependencies: ToolDependency[] = []
const preloadActions: CommandMeta[] = [
  {
    id: 'manifest',
    title: '当前 Manifest',
    description: '通过 window.brickly.getManifest() 读取当前工具声明。',
    category: 'brickly',
    input: {},
    mode: 'invoke',
    fields: []
  },
  {
    id: 'app-info',
    title: '平台应用信息',
    description: '通过 window.brickly.system 读取应用名称、版本、平台和用户目录。',
    category: 'brickly.system',
    input: {},
    mode: 'invoke',
    fields: []
  },
  {
    id: 'pick-directory',
    title: '选择目录',
    description: '通过 window.brickly.fs.pickDirectory() 打开受控目录选择器。',
    category: 'brickly.fs',
    input: {},
    mode: 'invoke',
    fields: []
  },
  {
    id: 'system-info',
    title: 'Node 系统信息',
    description: '通过自定义 preload 封装读取 platform、arch、Node 版本、CPU 数量等信息。',
    category: 'custom preload',
    input: {},
    mode: 'invoke',
    fields: []
  },
  {
    id: 'demo-file',
    title: '临时文件读写',
    description: '通过 preload 封装写入并读取一个临时文本文件。',
    category: 'preload',
    input: { content: 'Hello from Brickly preload' },
    mode: 'invoke',
    fields: [
      { name: 'content', label: '文件内容', type: 'string', required: false, default: 'Hello from Brickly preload' }
    ]
  },
  {
    id: 'host-version',
    title: '受控命令执行',
    description: '通过 execFile 包装执行宿主进程版本命令，不直接暴露 child_process。',
    category: 'preload',
    input: {},
    mode: 'invoke',
    fields: []
  },
  ...(toolDependencies.length
    ? [
        {
          id: 'invoke-dependency',
          title: '调用依赖工具',
          description: '使用已声明依赖工具的 brickId、commandId、input 和可选 profileId 发起调用。',
          category: 'dependency',
          input: { brickId: toolDependencies[0].brickId, commandId: 'hello', input: { name: 'Brickly' } },
          mode: 'invoke',
          fields: [
            { name: 'brickId', label: '依赖工具 id', type: 'string', required: true, default: toolDependencies[0].brickId },
            { name: 'commandId', label: '命令 id', type: 'string', required: true, default: 'hello' },
            { name: 'input', label: '命令参数', type: 'json', required: false, default: { name: 'Brickly' } },
            { name: 'profileId', label: 'Profile id', type: 'string', required: false }
          ]
        }
      ]
    : [])
]
const runnerItems = runtime === 'none' ? preloadActions : commands

declare global {
  interface Window {
    brickly?: {
      readonly ref: ToolDependency
      invoke?(commandId: string, input: Record<string, unknown>): Promise<unknown>
      call?(
        commandId: string,
        input: Record<string, unknown>,
        options: { onEvent: (event: unknown) => void }
      ): Promise<unknown>
      interact?(
        commandId: string,
        input: Record<string, unknown>,
        options: { onEvent: (event: unknown) => void }
      ): Promise<{ end(): Promise<unknown> }>
      getManifest(): Promise<unknown>
      fs: {
        pickDirectory(options?: { defaultPath?: string }): Promise<string | undefined>
      }
      system: {
        getAppName(): Promise<string>
        getAppVersion(): Promise<string>
        getPath(name: 'userData' | 'home' | 'temp' | 'desktop' | 'documents' | 'downloads'): Promise<string>
        isMacOS(): Promise<boolean>
        isWindows(): Promise<boolean>
        isLinux(): Promise<boolean>
      }
    }
    toolNode?: {
      systemInfo(): Record<string, unknown>
      demoFilePath(): string
      writeDemoFile(content?: string): Promise<{ ok: true; path: string }>
      readDemoFile(): Promise<{ path: string; content: string }>
      runHostVersion(): Promise<{ stdout: string; stderr: string }>
      invokeDependency(brickId: string, commandId: string, input?: Record<string, unknown>, profileId?: string): Promise<unknown>
      toolDependencies(): ToolDependency[]
    }
  }
}

function cleanErrorMessage(message: string): string {
  const text = message.replace(/^Error invoking remote method '[^']+':\s*/u, '')
  return text === '[object Object]' ? '未知错误，请查看主进程日志。' : text
}

function formatDetails(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatError(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = error as { message?: unknown; code?: unknown; details?: unknown }
    const message = cleanErrorMessage(
      typeof data.message === 'string' ? data.message : formatDetails(data)
    )
    return [
      '命令运行失败',
      typeof data.code === 'string' ? '错误代码：' + data.code : '',
      message,
      data.details ? '详情：' + formatDetails(data.details) : ''
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return ['命令运行失败', cleanErrorMessage(String(error))].join('\n\n')
}

function formatInline(value: unknown): string {
  if (value === undefined) return ''
  const text = typeof value === 'string' ? value : formatDetails(value)
  return text.length > 80 ? text.slice(0, 77) + '...' : text
}

function formatStreamSection(type: string, value?: unknown, name?: string): string {
  const label = name ? '[' + type + ':' + name + ']' : '[' + type + ']'
  return value === undefined || value === '' ? label : label + '\n' + formatDetails(value)
}

function parseInput(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  const value = JSON.parse(trimmed) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('输入必须是 JSON 对象。')
  }
  return value as Record<string, unknown>
}

async function runPreloadAction(commandId: string, input: Record<string, unknown>) {
  const brickly = window.brickly
  if (!brickly) throw new Error('当前页面没有加载 window.brickly。')
  if (commandId === 'manifest') return brickly.getManifest()
  if (commandId === 'app-info') {
    return {
      ref: brickly.ref,
      appName: await brickly.system.getAppName(),
      appVersion: await brickly.system.getAppVersion(),
      userData: await brickly.system.getPath('userData'),
      platform: {
        isMacOS: await brickly.system.isMacOS(),
        isWindows: await brickly.system.isWindows(),
        isLinux: await brickly.system.isLinux()
      }
    }
  }
  if (commandId === 'pick-directory') {
    const path = await brickly.fs.pickDirectory()
    return { path: path || null }
  }
  const api = window.toolNode
  if (!api) throw new Error('当前页面没有加载自定义 preload，无法使用 window.toolNode。')
  if (commandId === 'system-info') return api.systemInfo()
  if (commandId === 'demo-file') {
    const content = typeof input.content === 'string' ? input.content : 'Hello from Brickly preload'
    const written = await api.writeDemoFile(content)
    const read = await api.readDemoFile()
    return { written, read }
  }
  if (commandId === 'host-version') return api.runHostVersion()
  if (commandId === 'invoke-dependency') {
    const brickId = String(input.brickId || '')
    const targetCommandId = String(input.commandId || '')
    const payload = input.input && typeof input.input === 'object' && !Array.isArray(input.input)
      ? (input.input as Record<string, unknown>)
      : {}
    const profileId = typeof input.profileId === 'string' ? input.profileId : undefined
    return api.invokeDependency(brickId, targetCommandId, payload, profileId)
  }
  throw new Error('未知 preload 示例：' + commandId)
}

export function App() {
  const [selectedId, setSelectedId] = useState(runnerItems[0]?.id ?? '')
  const selectedCommand = useMemo(
    () => runnerItems.find((command) => command.id === selectedId) ?? runnerItems[0],
    [selectedId]
  )
  const [inputText, setInputText] = useState(() =>
    JSON.stringify(runnerItems[0]?.input ?? {}, null, 2)
  )
  const [output, setOutput] = useState('准备就绪')
  const [status, setStatus] = useState<RunStatus>('idle')

  function selectCommand(command: CommandMeta) {
    setSelectedId(command.id)
    setInputText(JSON.stringify(command.input ?? {}, null, 2))
    setOutput('已载入示例输入。')
    setStatus('idle')
  }

  function runStreamCommand(command: CommandMeta, input: Record<string, unknown>): Promise<void> {
    const api = window.brickly
    let content = ''
    const write = () => setOutput(content || '等待过程输出...')
    const appendSection = (line: string) => {
      if (content && !content.endsWith('\n')) content += '\n'
      content += (content ? '\n' : '') + line + '\n'
      write()
    }
    const onEvent = (event: unknown) => {
      appendSection(formatStreamSection('event', event))
    }
    appendSection(formatStreamSection('start', command.id))
    if (command.mode === 'interact') {
      if (!api?.interact) throw new Error('当前页面没有加载 brick.interact。')
      return api.interact(command.id, input, { onEvent }).then((session) =>
        session.end().then((result) => {
          appendSection(formatStreamSection('result', result))
        })
      )
    }
    if (!api?.call) throw new Error('当前页面没有加载 brick.call。')
    return api.call(command.id, input, { onEvent }).then((result) => {
      appendSection(formatStreamSection('result', result))
    })
  }

  async function runSelected() {
    setStatus('running')
    try {
      if (!selectedCommand) throw new Error('没有可运行的示例。')
      if (runtime === 'none') {
        const result = await runPreloadAction(selectedCommand.id, parseInput(inputText))
        setOutput(formatDetails(result))
        setStatus('success')
        return
      }
      const input = parseInput(inputText)
      if (selectedCommand.mode === 'call' || selectedCommand.mode === 'interact') {
        await runStreamCommand(selectedCommand, input)
        setStatus('success')
        return
      }
      const result = await window.brickly?.invoke?.(selectedCommand.id, input)
      setOutput(formatDetails(result))
      setStatus('success')
    } catch (error) {
      setOutput(formatError(error))
      setStatus('error')
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{runtime === 'none' ? '纯 UI 工具' : 'SDK Runtime 工具'}</p>
          <h1>Starter Node React</h1>
          <span>Starter Node React generated by Brickly Tool Starter.</span>
        </div>
        <div className={'status-pill ' + status}>
          {status === 'running' ? '运行中' : status === 'success' ? '已完成' : status === 'error' ? '失败' : '就绪'}
        </div>
      </header>

      <section className="metrics">
        <div>
          <span>Runtime</span>
          <strong>{runtime === 'none' ? 'Pure UI' : runtime}</strong>
        </div>
        <div>
          <span>命令</span>
          <strong>{runnerItems.length}</strong>
        </div>
        <div>
          <span>依赖</span>
          <strong>{toolDependencies.length}</strong>
        </div>
      </section>

      <section className="workspace">
        <aside className="panel command-panel">
          <div className="panel-head">
            <span>命令</span>
            <small>{runtime === 'none' ? 'preload' : 'sdk'}</small>
          </div>
          <div className="command-list">
            {runnerItems.map((command) => (
              <button
                key={command.id}
                className={'command-item ' + (selectedCommand?.id === command.id ? 'active' : '')}
                onClick={() => selectCommand(command)}
              >
                <strong>{command.title}</strong>
                <span>{command.description}</span>
                <code>{command.id}</code>
                {command.mode !== 'invoke' && <em>{command.mode}</em>}
              </button>
            ))}
          </div>
        </aside>

        <section className="panel runner-panel">
          <div className="panel-head">
            <span>{selectedCommand?.title ?? 'Preload 示例'}</span>
            <small>{selectedCommand?.category ?? 'ui'}</small>
          </div>
          {selectedCommand?.fields.length ? (
            <div className="field-list">
              {selectedCommand.fields.map((field) => (
                <div key={field.name} className="field-item">
                  <div>
                    <strong>{field.label || field.name}</strong>
                    <code>{field.type}</code>
                    {field.required && <span>必填</span>}
                  </div>
                  <p>{field.description || (field.default !== undefined ? '默认值：' + formatInline(field.default) : '无说明')}</p>
                  <small>{field.name}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="field-empty">此示例不需要输入参数。</p>
          )}
          <textarea
            value={inputText}
            disabled={!selectedCommand?.fields.length}
            spellCheck={false}
            onChange={(event) => setInputText(event.target.value)}
          />
          <div className="actions">
            <button onClick={runSelected} disabled={status === 'running'}>
              {status === 'running' ? '运行中...' : runtime === 'none' ? '运行 preload 示例' : selectedCommand?.mode === 'call' ? '运行 call' : selectedCommand?.mode === 'interact' ? '运行 interact' : '运行命令'}
            </button>
            <button
              className="secondary"
              onClick={() => setOutput(JSON.stringify({ toolDependencies }, null, 2))}
              disabled={!toolDependencies.length}
            >
              查看依赖
            </button>
          </div>
          <pre className={'output ' + status}>{output}</pre>
        </section>

        <aside className="panel dependency-panel">
          <div className="panel-head">
            <span>依赖工具</span>
            <small>{toolDependencies.length}</small>
          </div>
          {toolDependencies.length ? (
            <ul>
              {toolDependencies.map((dependency) => (
                <li key={dependency.brickId}>
                  <code>{dependency.brickId}</code>
                  {dependency.note && <span>{dependency.note}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">暂未声明依赖工具。</p>
          )}
        </aside>
      </section>
    </main>
  )
}

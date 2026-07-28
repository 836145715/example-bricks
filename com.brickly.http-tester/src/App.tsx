import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react'
import { isBricklyAvailable, sendRequest } from '@/brickly'
import { KeyValueEditor } from '@/components/KeyValueEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { methodClass, prettyBody, statusTone } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { HistoryItem, HttpMethod, NameValue, SendResult } from '@/types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const MAX_HISTORY = 20

function normalizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  return String(error)
}

function filterNamed(rows: NameValue[]): NameValue[] {
  return rows.filter((r) => r.name.trim().length > 0)
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString()
  } catch {
    return ''
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function App() {
  const bricklyOk = isBricklyAvailable()

  const [method, setMethod] = useState<HttpMethod>('GET')
  const [url, setUrl] = useState('https://httpbin.org/get')
  const [query, setQuery] = useState<NameValue[]>([])
  const [headers, setHeaders] = useState<NameValue[]>([])
  const [body, setBody] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(30000)

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [pretty, setPretty] = useState(true)
  const [requestTab, setRequestTab] = useState('query')
  const [responseTab, setResponseTab] = useState('body')
  const [copied, setCopied] = useState(false)

  const displayBody = useMemo(() => {
    if (!result) return ''
    return pretty ? prettyBody(result.body, result.contentType) : result.body
  }, [result, pretty])

  const pushHistory = useCallback((item: HistoryItem) => {
    setHistory((prev) => [item, ...prev].slice(0, MAX_HISTORY))
  }, [])

  const handleSend = useCallback(async () => {
    if (busy || !bricklyOk) return
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setError('请填写 URL')
      setResult(null)
      return
    }

    const q = filterNamed(query)
    const h = filterNamed(headers)
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000

    setBusy(true)
    setError(null)

    const base: Omit<HistoryItem, 'status' | 'durationMs' | 'error'> = {
      id: makeId(),
      at: Date.now(),
      method,
      url: trimmedUrl,
      headers: h,
      query: q,
      body,
      timeoutMs: timeout,
    }

    try {
      const res = await sendRequest({
        method,
        url: trimmedUrl,
        headers: h,
        query: q,
        body: body || undefined,
        timeoutMs: timeout,
      })
      setResult(res)
      setError(null)
      pushHistory({
        ...base,
        status: res.status,
        durationMs: res.durationMs,
      })
      setResponseTab('body')
    } catch (err) {
      const msg = normalizeError(err)
      setError(msg)
      setResult(null)
      pushHistory({
        ...base,
        error: msg,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, bricklyOk, url, query, headers, body, timeoutMs, method, pushHistory])

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  const loadHistory = (item: HistoryItem) => {
    setMethod(item.method)
    setUrl(item.url)
    setQuery(item.query.length ? item.query.map((r) => ({ ...r })) : [])
    setHeaders(item.headers.length ? item.headers.map((r) => ({ ...r })) : [])
    setBody(item.body)
    setTimeoutMs(item.timeoutMs)
    setError(null)
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const formatJsonBody = () => {
    try {
      const parsed = JSON.parse(body)
      setBody(JSON.stringify(parsed, null, 2))
    } catch {
      // leave as-is if invalid
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Banner when brickly unavailable */}
      {!bricklyOk && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            window.brickly 不可用。请在 Brickly Webview 中打开本工具；发送已禁用。
          </span>
        </div>
      )}

      {/* Top bar: method + url + send */}
      <div className="border-b border-border bg-card/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Select value={method} onValueChange={(v) => setMethod(v as HttpMethod)}>
            <SelectTrigger className={cn('w-[110px] font-mono font-semibold', methodClass(method))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m} className={cn('font-mono font-semibold', methodClass(m))}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            placeholder="https://api.example.com/path"
            className="flex-1 font-mono text-sm h-9"
            spellCheck={false}
          />

          <div className="flex items-center gap-1.5 shrink-0">
            <Input
              type="number"
              min={1000}
              max={120000}
              step={1000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value) || 30000)}
              className="w-[96px] h-9 font-mono text-xs"
              title="超时 (ms)"
              aria-label="超时毫秒"
            />
            <span className="text-[10px] text-muted-foreground hidden sm:inline">ms</span>
          </div>

          <Button
            onClick={() => void handleSend()}
            disabled={busy || !bricklyOk}
            className="shrink-0 min-w-[96px]"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                发送中
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                发送
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main: history | request | response */}
      <div className="flex-1 flex min-h-0">
        {/* History sidebar */}
        <aside className="w-56 shrink-0 border-r border-border bg-card/30 flex flex-col min-h-0">
          <div className="px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            历史
            {history.length > 0 && (
              <span className="ml-auto normal-case tracking-normal text-[10px] opacity-70">
                {history.length}
              </span>
            )}
          </div>
          <Separator />
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {history.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  发送请求后将显示在这里
                </p>
              )}
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => loadHistory(item)}
                  className="w-full text-left rounded-md border border-transparent hover:border-border hover:bg-muted/50 px-2.5 py-2 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('text-[11px] font-mono font-bold shrink-0', methodClass(item.method))}>
                      {item.method}
                    </span>
                    {item.error ? (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                        ERR
                      </Badge>
                    ) : item.status != null ? (
                      <Badge variant={statusTone(item.status)} className="text-[10px] px-1.5 py-0 h-4">
                        {item.status}
                      </Badge>
                    ) : null}
                    {item.durationMs != null && (
                      <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                        {item.durationMs}ms
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono text-muted-foreground truncate group-hover:text-foreground/80">
                    {item.url}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                    {formatTime(item.at)}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Request panel */}
        <section className="flex-1 min-w-0 flex flex-col border-r border-border min-h-0">
          <div className="px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            请求
          </div>
          <Separator />
          <div className="flex-1 min-h-0 p-3 flex flex-col">
            <Tabs value={requestTab} onValueChange={setRequestTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-fit">
                <TabsTrigger value="query">
                  Query
                  {filterNamed(query).length > 0 && (
                    <span className="ml-1.5 text-[10px] opacity-70">{filterNamed(query).length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="headers">
                  Headers
                  {filterNamed(headers).length > 0 && (
                    <span className="ml-1.5 text-[10px] opacity-70">{filterNamed(headers).length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="body">Body</TabsTrigger>
              </TabsList>

              <TabsContent value="query" className="flex-1 mt-3 overflow-auto">
                <div className="rounded-lg border border-border bg-card p-3">
                  <KeyValueEditor
                    value={query}
                    onChange={setQuery}
                    namePlaceholder="key"
                    valuePlaceholder="value"
                  />
                </div>
              </TabsContent>

              <TabsContent value="headers" className="flex-1 mt-3 overflow-auto">
                <div className="rounded-lg border border-border bg-card p-3">
                  <KeyValueEditor
                    value={headers}
                    onChange={setHeaders}
                    namePlaceholder="Header"
                    valuePlaceholder="Value"
                  />
                </div>
              </TabsContent>

              <TabsContent value="body" className="flex-1 mt-3 flex flex-col min-h-0">
                <div className="flex items-center justify-end mb-2">
                  <Button type="button" variant="outline" size="sm" onClick={formatJsonBody} className="gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    格式化 JSON
                  </Button>
                </div>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder='{"key": "value"}'
                  className="flex-1 min-h-[200px] font-mono text-xs resize-none"
                  spellCheck={false}
                />
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {/* Response panel */}
        <section className="flex-1 min-w-0 flex flex-col min-h-0 bg-card/20">
          <div className="px-3 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">
              响应
            </span>
            {result && (
              <>
                <Badge variant={statusTone(result.status)}>
                  {result.status} {result.statusText}
                </Badge>
                <Badge variant="muted" className="font-mono gap-1">
                  <Clock className="h-3 w-3" />
                  {result.durationMs} ms
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {formatBytes(result.bodySize)}
                  {result.truncated ? ' · truncated' : ''}
                </Badge>
                {result.contentType && (
                  <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
                    {result.contentType}
                  </span>
                )}
              </>
            )}
            {error && !result && (
              <Badge variant="destructive">Error</Badge>
            )}
          </div>
          <Separator />

          {error && (
            <div className="mx-3 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <pre className="font-mono text-xs whitespace-pre-wrap break-words m-0">{error}</pre>
            </div>
          )}

          {!result && !error && (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
              填写 URL 后点击发送，响应将显示在此处
            </div>
          )}

          {result && (
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <Tabs value={responseTab} onValueChange={setResponseTab} className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <TabsList className="w-fit">
                    <TabsTrigger value="body">Body</TabsTrigger>
                    <TabsTrigger value="headers">Headers</TabsTrigger>
                  </TabsList>
                  <div className="ml-auto flex items-center gap-1.5">
                    {responseTab === 'body' && (
                      <Button
                        type="button"
                        variant={pretty ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => setPretty((p) => !p)}
                        className="text-xs"
                      >
                        Pretty
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        void handleCopy(
                          responseTab === 'body'
                            ? displayBody
                            : Object.entries(result.headers)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join('\n')
                        )
                      }
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? '已复制' : '复制'}
                    </Button>
                  </div>
                </div>

                <TabsContent value="body" className="flex-1 mt-3 min-h-0 overflow-hidden">
                  <div className="h-full rounded-lg border border-border bg-card overflow-auto">
                    <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words m-0 text-foreground/90">
                      {displayBody || <span className="text-muted-foreground">(empty body)</span>}
                    </pre>
                  </div>
                  {result.finalUrl && result.finalUrl !== url && (
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground truncate">
                      final: {result.finalUrl}
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="headers" className="flex-1 mt-3 min-h-0 overflow-hidden">
                  <div className="h-full rounded-lg border border-border bg-card overflow-auto">
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {Object.entries(result.headers).map(([k, v]) => (
                          <tr key={k} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-1.5 text-muted-foreground align-top whitespace-nowrap w-[30%]">
                              {k}
                            </td>
                            <td className="px-3 py-1.5 text-foreground/90 break-all">{v}</td>
                          </tr>
                        ))}
                        {Object.keys(result.headers).length === 0 && (
                          <tr>
                            <td className="px-3 py-4 text-muted-foreground" colSpan={2}>
                              (no headers)
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

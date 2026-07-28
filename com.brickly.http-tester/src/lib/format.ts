export function prettyBody(body: string, contentType: string): string {
  const ct = (contentType || '').toLowerCase()
  if (!ct.includes('json') && !body.trim().startsWith('{') && !body.trim().startsWith('[')) {
    return body
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

export function statusTone(status?: number): 'success' | 'info' | 'warning' | 'destructive' | 'muted' {
  if (status == null) return 'muted'
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'info'
  if (status >= 400 && status < 500) return 'warning'
  if (status >= 500) return 'destructive'
  return 'muted'
}

export function methodClass(method: string): string {
  switch (method) {
    case 'GET': return 'text-emerald-400'
    case 'POST': return 'text-sky-400'
    case 'PUT': return 'text-amber-400'
    case 'PATCH': return 'text-violet-400'
    case 'DELETE': return 'text-rose-400'
    default: return 'text-muted-foreground'
  }
}

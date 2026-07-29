import { supabase } from '@/lib/supabase/client'
import { functionNameForPath } from '@/lib/backend/routing'

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown> | null
}

interface CollectionOptions {
  filter?: string
  sort?: string
  expand?: string
  fields?: string
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response: Record<string, any> = {},
  ) {
    super(message)
  }
}

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321').replace(
  /\/$/,
  '',
)
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

export function backendUrl(path: string) {
  return `${supabaseUrl}/functions/v1/${functionNameForPath(path)}${path}`
}

export function backendPublicHeaders() {
  return publishableKey ? { apikey: publishableKey } : {}
}

async function send(path: string, options: RequestOptions = {}) {
  const functionName = functionNameForPath(path)
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (publishableKey) headers.set('apikey', publishableKey)

  if (functionName === 'admin-api' && !headers.has('Authorization')) {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) {
      headers.set('Authorization', `Bearer ${data.session.access_token}`)
    }
  }

  let requestBody = options.body
  if (
    requestBody &&
    typeof requestBody === 'object' &&
    !(requestBody instanceof Blob) &&
    !(requestBody instanceof FormData) &&
    !(requestBody instanceof URLSearchParams)
  ) {
    requestBody = JSON.stringify(requestBody)
  }

  const method = options.method || 'GET'
  const maxAttempts = method === 'GET' ? 3 : 1
  let response: Response | undefined
  let networkError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(backendUrl(path), {
        ...options,
        method,
        headers,
        body: requestBody as BodyInit | null | undefined,
      })
      if (response.status < 500 || attempt === maxAttempts) break
    } catch (error) {
      networkError = error
      if (attempt === maxAttempts) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250 + Math.random() * 150))
  }
  if (!response) throw networkError ?? new Error('Falha de rede.')
  const text = await response.text()
  let data: any = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { message: text || `HTTP ${response.status}` }
  }
  if (!response.ok) {
    throw new BackendError(
      data.message || data.error || `HTTP ${response.status}`,
      response.status,
      data,
    )
  }
  return data
}

function collection<T = any>(name: string) {
  const invoke = (payload: Record<string, unknown>) =>
    send(`/backend/v1/admin/collections/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: payload,
    })

  return {
    getList(page = 1, perPage = 30, options: CollectionOptions = {}) {
      return invoke({ action: 'getList', page, perPage, options }) as Promise<{
        page: number
        perPage: number
        totalItems: number
        totalPages: number
        items: T[]
      }>
    },
    getFullList(options: CollectionOptions = {}) {
      return invoke({ action: 'getFullList', options }) as Promise<T[]>
    },
    create(data: Record<string, unknown>) {
      return invoke({ action: 'create', data }) as Promise<T>
    },
    update(id: string, data: Record<string, unknown>) {
      return invoke({ action: 'update', id, data }) as Promise<T>
    },
    delete(id: string) {
      return invoke({ action: 'delete', id }) as Promise<{ success: boolean }>
    },
  }
}

function filter(template: string, params: Record<string, unknown>) {
  return template.replace(/\{:(\w+)\}/g, (_match, key: string) =>
    JSON.stringify(String(params[key] ?? '')),
  )
}

const backend = { send, collection, filter }

export default backend

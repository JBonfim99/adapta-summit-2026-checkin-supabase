const configuredOrigin = Deno.env.get('APP_URL') ?? '*'

export const corsHeaders = {
  'Access-Control-Allow-Origin': configuredOrigin,
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-api-key, x-buyer-token, x-helpdesk-key, x-sync-signature, x-sync-timestamp, x-worker-key',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  Vary: 'Origin',
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export async function body<T extends Record<string, unknown>>(req: Request): Promise<T> {
  if (!req.body) return {} as T
  try {
    return (await req.json()) as T
  } catch {
    throw new ApiError(400, 'JSON_INVALIDO')
  }
}

export function routePath(req: Request, functionName: string): string {
  const pathname = new URL(req.url).pathname
  const marker = `/${functionName}`
  const index = pathname.indexOf(marker)
  const path = index >= 0 ? pathname.slice(index + marker.length) : pathname
  return path || '/'
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ error: error.message, message: error.message, details: error.details }, error.status)
  }

  const message = error instanceof Error ? error.message : 'ERRO_INTERNO'
  console.error(message)
  return json({ error: 'ERRO_INTERNO', message: 'Nao foi possivel concluir a operacao.' }, 500)
}

export async function handler(
  req: Request,
  callback: () => Promise<Response>,
): Promise<Response> {
  if (req.method === 'OPTIONS') return noContent()
  try {
    return await callback()
  } catch (error) {
    return errorResponse(error)
  }
}

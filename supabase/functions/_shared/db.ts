import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { ApiError } from './http.ts'

let cachedAdmin: SupabaseClient | undefined

export function adminDb(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRole) throw new Error('SUPABASE_SERVER_CONFIGURATION_MISSING')

  cachedAdmin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedAdmin
}

export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  options: { retryTransient?: boolean } = {},
): Promise<T> {
  const attempts = options.retryTransient ? 3 : 1
  let lastError: { message: string } | undefined

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await adminDb().rpc(name, args)
    if (!error) return data as T

    lastError = error
    const transient = /TypeError|sending request|fetch|connection|timeout/i.test(error.message)
    if (!transient || attempt === attempts) {
      const status = transient
        ? 503
        : error.message.includes('NOT_FOUND') || error.message.includes('INVALID_OR_EXPIRED')
          ? 404
          : error.message.includes('ALREADY') ||
              error.message.includes('STALE') ||
              error.message.includes('IN_PROGRESS')
            ? 409
            : 400
      throw new ApiError(status, error.message)
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 100 + Math.random() * 100))
  }

  throw new ApiError(503, lastError?.message ?? 'DATABASE_UNAVAILABLE')
}

export async function requireAdmin(req: Request, roles = ['admin', 'operator', 'viewer']) {
  const authorization = req.headers.get('Authorization') ?? ''
  const accessToken = authorization.replace(/^Bearer\s+/i, '')
  if (!accessToken) throw new ApiError(401, 'ADMIN_AUTH_REQUIRED')

  const db = adminDb()
  const { data: authData, error: authError } = await db.auth.getUser(accessToken)
  if (authError || !authData.user) throw new ApiError(401, 'ADMIN_SESSION_INVALID')

  const { data: profile, error: profileError } = await db
    .from('admin_profiles')
    .select('user_id,display_name,role,active')
    .eq('user_id', authData.user.id)
    .eq('active', true)
    .single()

  if (profileError || !profile || !roles.includes(profile.role)) {
    throw new ApiError(403, 'ADMIN_ACCESS_DENIED')
  }

  return { user: authData.user, profile }
}

export function buyerToken(req: Request): string {
  const explicit = req.headers.get('X-Buyer-Token')
  const authorization = req.headers.get('Authorization') ?? ''
  const token = explicit || authorization.replace(/^Bearer\s+/i, '')
  if (!token) throw new ApiError(401, 'BUYER_TOKEN_REQUIRED')
  return token
}

export function requireHelpdesk(req: Request): string {
  const supplied = req.headers.get('X-Helpdesk-Key') ?? ''
  const configured = Deno.env.get('HELPDESK_KEY') ?? Deno.env.get('HELPDESK_PASSWORD') ?? ''
  if (!configured || supplied.length !== configured.length) {
    throw new ApiError(401, 'HELPDESK_ACCESS_DENIED')
  }

  let mismatch = 0
  for (let index = 0; index < configured.length; index += 1) {
    mismatch |= configured.charCodeAt(index) ^ supplied.charCodeAt(index)
  }
  if (mismatch !== 0) throw new ApiError(401, 'HELPDESK_ACCESS_DENIED')
  return supplied
}

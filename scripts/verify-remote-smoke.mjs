import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

async function parseEnv(path) {
  const text = await readFile(path, 'utf8')
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        let value = line.slice(separator + 1).trim()
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1)
        }
        return [line.slice(0, separator), value]
      }),
  )
}

function required(values, name) {
  const value = values[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const frontend = await parseEnv('.env.local')
const remote = await parseEnv('supabase/.env.remote.local')
const supabaseUrl = required(frontend, 'VITE_SUPABASE_URL').replace(/\/$/, '')
const publishableKey = required(frontend, 'VITE_SUPABASE_PUBLISHABLE_KEY')
const project = new URL(supabaseUrl).hostname.split('.')[0]

if (project !== 'idiagqbfmvyoywyjfufe') {
  throw new Error(`Refusing remote smoke test for unexpected project: ${project}`)
}

const functionsUrl = `${supabaseUrl}/functions/v1`

async function request(name, functionName, path, expectedStatus, init = {}) {
  const response = await fetch(`${functionsUrl}/${functionName}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(data)}`)
  }
  return data
}

const missingEmail = `remote-smoke-${Date.now()}@adapta.test`
await request('unknown buyer email', 'public-api', '/backend/v1/auth/magic-link', 400, {
  method: 'POST',
  body: JSON.stringify({ email: missingEmail }),
})
await request(
  'invalid participant link',
  'public-api',
  '/backend/v1/participant/link/remote-smoke-invalid',
  404,
)
await request('invalid buyer token', 'buyer-api', '/backend/v1/buyer/tickets', 404, {
  headers: { Authorization: 'Bearer remote-smoke-invalid' },
})
await request(
  'helpdesk read',
  'helpdesk-api',
  '/backend/v1/helpdesk/search?q=remote-smoke-missing',
  200,
)
await request(
  'external API read',
  'public-api',
  `/backend/v1/external/compradores?email=${encodeURIComponent(missingEmail)}`,
  200,
  { headers: { 'X-Api-Key': required(remote, 'EXTERNAL_API_KEY') } },
)

const auth = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: session, error: signInError } = await auth.auth.signInWithPassword({
  email: required(remote, 'ADMIN_EMAIL'),
  password: required(remote, 'ADMIN_PASSWORD'),
})
if (signInError || !session.session) {
  throw new Error(`admin login: ${signInError?.message ?? 'session missing'}`)
}

const adminHeaders = { Authorization: `Bearer ${session.session.access_token}` }
const stats = await request('admin stats', 'admin-api', '/backend/v1/admin/stats', 200, {
  headers: adminHeaders,
})
const templates = await request(
  'SendGrid mock templates',
  'admin-api',
  '/backend/v1/admin/sendgrid/templates',
  200,
  { headers: adminHeaders },
)
await request('system health', 'admin-api', '/backend/v1/admin/system/health', 200, {
  headers: adminHeaders,
})

if (!Array.isArray(templates.templates) || templates.templates.length === 0) {
  throw new Error('SendGrid mock templates: empty response')
}

console.log(
  JSON.stringify(
    {
      project,
      public: 'ok',
      buyerAuthBoundary: 'ok',
      helpdesk: 'ok',
      externalApi: 'ok',
      admin: 'ok',
      sendgridMockTemplates: templates.templates.length,
      totals: {
        compradores: stats.compradores_total,
        ingressos: stats.total,
      },
    },
    null,
    2,
  ),
)

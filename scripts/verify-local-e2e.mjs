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
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

const frontend = await parseEnv('.env.local')
const functions = await parseEnv('supabase/.env.local')
const supabaseUrl = frontend.VITE_SUPABASE_URL
const publishableKey = frontend.VITE_SUPABASE_PUBLISHABLE_KEY
const functionsUrl = `${supabaseUrl}/functions/v1`

if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error('A verificacao E2E aceita somente o Supabase local.')
}

async function request(name, functionName, path, init = {}) {
  const response = await fetch(`${functionsUrl}/${functionName}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const buyer = await request(
  'Acesso do comprador',
  'public-api',
  '/backend/v1/auth/magic-link/consume',
  {
    method: 'POST',
    body: JSON.stringify({ token: 'e2e-local-buyer-token-2026' }),
  },
)

const tickets = await request('Ingressos do comprador', 'buyer-api', '/backend/v1/buyer/tickets', {
  headers: { 'X-Buyer-Token': 'e2e-local-buyer-token-2026' },
})

const participant = await request(
  'Link do participante',
  'public-api',
  '/backend/v1/participant/link/e2e-local-participant-token-2026',
)

await request('Login do helpdesk', 'helpdesk-api', '/backend/v1/helpdesk/login', {
  method: 'POST',
  headers: { 'X-Helpdesk-Key': functions.HELPDESK_KEY },
  body: '{}',
})

const auth = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: session, error: signInError } = await auth.auth.signInWithPassword({
  email: 'admin.local@adapta.test',
  password: 'AdminLocal#2026',
})
if (signInError || !session.session) {
  throw new Error(`Login administrativo: ${signInError?.message ?? 'sessao ausente'}`)
}

const stats = await request('Dashboard administrativo', 'admin-api', '/backend/v1/admin/stats', {
  headers: { Authorization: `Bearer ${session.session.access_token}` },
})
const insights = await request(
  'Insights administrativos',
  'admin-api',
  '/backend/v1/admin/insights',
  {
    headers: { Authorization: `Bearer ${session.session.access_token}` },
  },
)
if (!insights.perfil || !insights.ia?.por_tipo || !insights.ferramentas) {
  throw new Error('Insights administrativos: contrato incompleto')
}

console.log(
  JSON.stringify(
    {
      buyer: buyer.comprador?.email,
      tickets: tickets.totalItems,
      participantTicket: participant.id,
      helpdesk: 'ok',
      admin: 'ok',
      insights: 'ok',
      stats: {
        compradores: stats.compradores_total,
        ingressos: stats.total,
      },
    },
    null,
    2,
  ),
)

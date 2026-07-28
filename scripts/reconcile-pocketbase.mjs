import { createClient } from '@supabase/supabase-js'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value.replace(/\/$/, '')
}

const pocketBaseUrl = required('POCKETBASE_URL')
const supabase = createClient(
  required('SUPABASE_URL'),
  required('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
)

async function authenticate() {
  const email = required('POCKETBASE_ADMIN_EMAIL')
  const password = required('POCKETBASE_ADMIN_PASSWORD')
  for (const endpoint of [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]) {
    const response = await fetch(`${pocketBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, email, password }),
    })
    if (response.ok) return (await response.json()).token
  }
  throw new Error('PocketBase authentication failed')
}

async function pocketBaseRecords(name, token) {
  const records = []
  let page = 1
  for (;;) {
    const url = new URL(`${pocketBaseUrl}/api/collections/${name}/records`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('perPage', '500')
    url.searchParams.set('fields', 'id,updated')
    const response = await fetch(url, { headers: { Authorization: token } })
    if (!response.ok) throw new Error(`${name}: PocketBase HTTP ${response.status}`)
    const data = await response.json()
    records.push(...data.items)
    if (page >= data.totalPages) return records
    page += 1
  }
}

async function supabaseRecords(name) {
  const records = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from(name)
      .select('id,updated_at')
      .order('id')
      .range(offset, offset + 999)
    if (error) throw error
    records.push(...data)
    if (data.length < 1000) return records
  }
}

async function main() {
  const token = await authenticate()
  const names = [
    'compradores',
    'ingressos',
    'participantes',
    'tokens_acesso',
    'links_participante',
    'webhooks_log',
  ]
  let failed = false
  for (const name of names) {
    const [source, target] = await Promise.all([
      pocketBaseRecords(name, token),
      supabaseRecords(name),
    ])
    const sourceIds = new Set(source.map((record) => record.id))
    const targetIds = new Set(target.map((record) => record.id))
    const missing = [...sourceIds].filter((id) => !targetIds.has(id))
    const extra = [...targetIds].filter((id) => !sourceIds.has(id))
    console.log(
      `${name}: source=${source.length} target=${target.length} missing=${missing.length} extra=${extra.length}`,
    )
    if (missing.length || extra.length) {
      failed = true
      console.log(`  missing sample: ${missing.slice(0, 10).join(', ') || '-'}`)
      console.log(`  extra sample: ${extra.slice(0, 10).join(', ') || '-'}`)
    }
  }
  if (failed) throw new Error('Reconciliation mismatch')

  await supabase
    .from('system_state')
    .update({ last_reconciled_at: new Date().toISOString() })
    .eq('singleton', true)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

import { createClient } from '@supabase/supabase-js'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value.replace(/\/$/, '')
}

const pocketBaseUrl = required('POCKETBASE_URL')
const adminEmail = required('POCKETBASE_ADMIN_EMAIL')
const adminPassword = required('POCKETBASE_ADMIN_PASSWORD')
const supabaseUrl = required('SUPABASE_URL')
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function authenticate() {
  const endpoints = [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]
  for (const endpoint of endpoints) {
    const response = await fetch(`${pocketBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: adminEmail, email: adminEmail, password: adminPassword }),
    })
    if (response.ok) return (await response.json()).token
  }
  throw new Error('PocketBase authentication failed')
}

async function fetchCollection(name, token) {
  const records = []
  let page = 1
  for (;;) {
    const url = new URL(`${pocketBaseUrl}/api/collections/${name}/records`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('perPage', '500')
    url.searchParams.set('sort', 'created')
    const response = await fetch(url, { headers: { Authorization: token } })
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
    const data = await response.json()
    records.push(...data.items)
    if (page >= data.totalPages) return records
    page += 1
  }
}

const timestamp = (record) => record.updated || record.created || new Date().toISOString()
const event = (table, record, phase = 'snapshot', overrides = {}) => ({
  event_id: `snapshot:${phase}:${table}:${record.id}:${timestamp(record)}`,
  table,
  record_id: record.id,
  operation: 'update',
  source_updated_at: timestamp(record),
  payload: {
    ...record,
    created_at: record.created,
    updated_at: record.updated,
    ...overrides,
  },
})

async function apply(events, label) {
  let applied = 0
  for (let offset = 0; offset < events.length; offset += 20) {
    const batch = events.slice(offset, offset + 20)
    const results = await Promise.all(
      batch.map(async (item) => {
        const { data, error } = await supabase.rpc('apply_sync_event', { p_event: item })
        if (error) throw new Error(`${label}/${item.record_id}: ${error.message}`)
        return data
      }),
    )
    applied += results.length
    process.stdout.write(`\r${label}: ${applied}/${events.length}`)
  }
  process.stdout.write('\n')
}

async function count(table) {
  const { count: value, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (error) throw error
  return value ?? 0
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
    'disparos',
    'envios',
    'pedidos_guru',
    'disparos_wa',
    'cortesias',
  ]
  const snapshot = Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await fetchCollection(name, token)])),
  )

  await apply(snapshot.compradores.map((row) => event('compradores', row)), 'compradores')
  await apply(snapshot.disparos.map((row) => event('disparos', row)), 'disparos')
  await apply(snapshot.disparos_wa.map((row) => event('disparos_wa', row)), 'disparos_wa')
  await apply(snapshot.cortesias.map((row) => event('cortesias', row)), 'cortesias')
  await apply(
    snapshot.ingressos.map((row) =>
      event('ingressos', row, 'ticket-stage', {
        status: 'Pendente',
        participante_id: '',
        preenchido_em: '',
      }),
    ),
    'ingressos stage',
  )
  await apply(snapshot.participantes.map((row) => event('participantes', row)), 'participantes')
  await apply(
    snapshot.ingressos.map((row) => event('ingressos', row, 'ticket-final')),
    'ingressos final',
  )
  await apply(snapshot.tokens_acesso.map((row) => event('tokens_acesso', row)), 'tokens')
  await apply(snapshot.links_participante.map((row) => event('links_participante', row)), 'links')
  await apply(snapshot.envios.map((row) => event('envios', row)), 'envios')
  await apply(snapshot.pedidos_guru.map((row) => event('pedidos_guru', row)), 'guru')
  await apply(snapshot.webhooks_log.map((row) => event('webhooks_log', row)), 'logs')

  const verification = {}
  for (const name of names) {
    verification[name] = {
      pocketbase: snapshot[name].length,
      supabase: await count(name),
    }
  }
  console.table(verification)
  const mismatch = Object.values(verification).some(
    (value) => value.pocketbase !== value.supabase,
  )
  if (mismatch) throw new Error('Import count mismatch')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

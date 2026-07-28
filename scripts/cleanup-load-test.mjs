import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const chunks = (items, size = 100) => {
  const result = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function all(table, columns, column, pattern) {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .like(column, pattern)
      .range(offset, offset + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

const tickets = await all('ingressos', 'id,participante_id', 'origem', 'load-test-%')
const buyers = await all('compradores', 'id', 'email', 'load.%@example.com')
const participantIds = tickets.map((ticket) => ticket.participante_id).filter(Boolean)

for (const batch of chunks(tickets.map((ticket) => ticket.id))) {
  await db
    .from('ingressos')
    .update({ participante_id: null, status: 'Pendente', preenchido_em: null })
    .in('id', batch)
}
for (const batch of chunks(participantIds)) {
  await db.from('participantes').delete().in('id', batch)
}
for (const batch of chunks(tickets.map((ticket) => ticket.id))) {
  await db.from('links_participante').delete().in('ingresso_id', batch)
  await db.from('ingressos').delete().in('id', batch)
}
for (const batch of chunks(buyers.map((buyer) => buyer.id))) {
  await db.from('tokens_acesso').delete().in('comprador_id', batch)
  await db.from('compradores').delete().in('id', batch)
}

console.log(`Removed ${tickets.length} load tickets and ${buyers.length} load buyers.`)

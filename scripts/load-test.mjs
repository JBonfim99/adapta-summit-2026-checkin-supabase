import { createClient } from '@supabase/supabase-js'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value.replace(/\/$/, '')
}

const supabaseUrl = required('SUPABASE_URL')
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = required('SUPABASE_PUBLISHABLE_KEY')
const functionsUrl =
  process.env.SUPABASE_FUNCTIONS_URL?.replace(/\/$/, '') || `${supabaseUrl}/functions/v1`
const ticketCount = Number(process.env.LOAD_TICKETS ?? 10_000)
const readConcurrency = Number(process.env.LOAD_READS ?? 500)
const writeConcurrency = Number(process.env.LOAD_WRITES ?? 100)
const keepData = process.env.LOAD_KEEP_DATA === 'true'
const ticketsPerBuyer = Math.ceil(ticketCount / readConcurrency)
const runId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const chunks = (items, size = 100) => {
  const result = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function insertBatches(table, rows) {
  for (const batch of chunks(rows)) {
    let lastError
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { error } = await db.from(table).insert(batch)
      if (!error) {
        lastError = null
        break
      }
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }
    if (lastError) throw new Error(`${table}: ${lastError.message}`)
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

async function call(functionName, path, options = {}) {
  const started = performance.now()
  const attempts = options.method && options.method !== 'GET' ? 1 : 3
  let lastResult
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${functionsUrl}/${functionName}${path}`, {
        ...options,
        headers: {
          apikey: publishableKey,
          'Content-Type': 'application/json',
          ...(options.headers ?? {}),
        },
      })
      const payload = await response.text()
      lastResult = {
        ok: response.ok,
        status: response.status,
        duration: performance.now() - started,
        payload,
      }
      if (response.status < 500 || attempt === attempts) return lastResult
    } catch (error) {
      lastResult = {
        ok: false,
        status: 0,
        duration: performance.now() - started,
        payload: error instanceof Error ? error.message : 'network error',
      }
      if (attempt === attempts) return lastResult
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250 + Math.random() * 150))
  }
  return lastResult
}

async function cleanup(ticketIds, participantIds, buyerIds) {
  for (const batch of chunks(ticketIds)) {
    await db.from('ingressos').update({
      participante_id: null,
      status: 'Pendente',
      preenchido_em: null,
    }).in('id', batch)
  }
  for (const batch of chunks(participantIds)) {
    if (batch.length) await db.from('participantes').delete().in('id', batch)
  }
  for (const batch of chunks(ticketIds)) {
    await db.from('links_participante').delete().in('ingresso_id', batch)
    await db.from('ingressos').delete().in('id', batch)
  }
  for (const batch of chunks(buyerIds)) {
    await db.from('tokens_acesso').delete().in('comprador_id', batch)
    await db.from('compradores').delete().in('id', batch)
  }
}

async function main() {
  const buyers = Array.from({ length: readConcurrency }, (_, index) => ({
    id: `load_b_${runId}_${index}`,
    nome: `Load Buyer ${index}`,
    email: `load.${runId}.${index}@example.com`,
  }))
  const tokens = buyers.map((buyer, index) => ({
    id: `load_tk_${runId}_${index}`,
    comprador_id: buyer.id,
    token: `load-token-${runId}-${index}`,
    expira_em: new Date(Date.now() + 3_600_000).toISOString(),
  }))
  const tickets = Array.from({ length: ticketCount }, (_, index) => ({
    id: `load_i_${runId}_${index}`,
    comprador_id: buyers[Math.floor(index / ticketsPerBuyer) % buyers.length].id,
    pedido_id: `LOAD-${runId}-${index}`,
    tipo_ingresso: index % 5 === 0 ? 'PLATINUM' : 'GOLD',
    origem: `load-test-${runId}`,
  }))
  const writeTickets = tickets.slice(0, Math.min(writeConcurrency, tickets.length))
  const links = writeTickets.map((ticket, index) => ({
    id: `load_l_${runId}_${index}`,
    ingresso_id: ticket.id,
    token: `load-link-${runId}-${index}`,
    expira_em: new Date(Date.now() + 3_600_000).toISOString(),
  }))

  console.log(`Run ${runId}: seeding ${buyers.length} buyers and ${tickets.length} tickets...`)
  let readFailures = []
  let writeFailures = []
  try {
    await insertBatches('compradores', buyers)
    await insertBatches('ingressos', tickets)
    await insertBatches('tokens_acesso', tokens)
    await insertBatches('links_participante', links)

    const reads = await Promise.all(
      tokens.map((token) =>
        call('buyer-api', '/backend/v1/buyer/tickets', {
          headers: { Authorization: `Bearer ${token.token}` },
        }),
      ),
    )
    const writes = await Promise.all(
      links.map((link, index) =>
        call('public-api', '/backend/v1/participant/submit', {
          method: 'POST',
          body: JSON.stringify({
            token: link.token,
            nome_completo: `Load Participant ${index}`,
            email: `load.participant.${runId}.${index}@example.com`,
            cpf: String(90000000000 + index),
            telefone: '11999999999',
            terms_accepted: true,
          }),
        }),
      ),
    )

    readFailures = reads.filter((result) => !result.ok)
    writeFailures = writes.filter((result) => !result.ok)
    console.log({
      reads: reads.length,
      readFailures: readFailures.length,
      readP95Ms: Math.round(percentile(reads.map((result) => result.duration), 0.95)),
      writes: writes.length,
      writeFailures: writeFailures.length,
      writeP95Ms: Math.round(percentile(writes.map((result) => result.duration), 0.95)),
    })
    if (readFailures.length) {
      console.log(
        'Read failure samples:',
        readFailures.slice(0, 5).map((result) => ({
          status: result.status,
          payload: result.payload.slice(0, 160),
        })),
      )
    }
    if (writeFailures.length) {
      console.log(
        'Write failure samples:',
        writeFailures.slice(0, 5).map((result) => ({
          status: result.status,
          payload: result.payload.slice(0, 160),
        })),
      )
    }
  } finally {
    if (!keepData) {
      const { data: participants } = await db
        .from('participantes')
        .select('id')
        .like('email', `load.participant.${runId}.%`)
      await cleanup(
        tickets.map((ticket) => ticket.id),
        (participants ?? []).map((participant) => participant.id),
        buyers.map((buyer) => buyer.id),
      )
    }
  }
  if (readFailures.length || writeFailures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

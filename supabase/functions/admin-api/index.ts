import { adminDb, requireAdmin, rpc } from '../_shared/db.ts'
import { ApiError, body, handler, json, routePath } from '../_shared/http.ts'
import {
  dispatchCredentialToInac,
  mutateCredentialledTicket,
} from '../_shared/ticket-operations.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import { callInac } from '../_shared/inac.ts'
import {
  auditEvent,
  createParticipantViewToken,
  requireOperationalWrite,
} from '../_shared/operations.ts'
import { handleAdminDataParity } from '../_shared/admin-data-parity.ts'
import { handleAdminDispatchParity } from '../_shared/admin-dispatch-parity.ts'

const collections = new Set([
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
  'cron_health',
  'system_state',
  'sync_events',
])
const mutableCollections = new Set(['compradores'])

async function fetchAll(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
) {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

function withCompatibilityFields<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    created: row.created_at,
    updated: row.updated_at,
  }
}

function applyFilter(query: any, filter = '') {
  const clauses = [...filter.matchAll(/([a-z_]+)\s*(=|~)\s*"([^"]*)"/g)]
  if (clauses.length === 0) return query

  const equals = clauses.filter((match) => match[2] === '=')
  const fuzzy = clauses.filter((match) => match[2] === '~')
  if (equals.length === 1) query = query.eq(equals[0][1], equals[0][3])
  if (equals.length > 1) {
    query = query.or(equals.map((match) => `${match[1]}.eq.${match[3]}`).join(','))
  }
  if (fuzzy.length > 0) {
    query = query.or(
      fuzzy.map((match) => `${match[1]}.ilike.%${match[3].replaceAll(',', ' ')}%`).join(','),
    )
  }
  return query
}

function applySort(query: any, sort = '-created') {
  const first = sort.split(',')[0] || '-created'
  const descending = first.startsWith('-')
  const raw = first.replace(/^-/, '')
  const column = raw === 'created' ? 'created_at' : raw === 'updated' ? 'updated_at' : raw
  return query.order(column, { ascending: !descending })
}

async function addExpansions(collection: string, rows: Array<Record<string, any>>, expand = '') {
  const db = adminDb()
  if (collection === 'ingressos' && expand.includes('participante_id')) {
    const ids = rows.map((row) => row.participante_id).filter(Boolean)
    const { data } =
      ids.length > 0 ? await db.from('participantes').select('*').in('id', ids) : { data: [] }
    const byId = new Map((data ?? []).map((item) => [item.id, withCompatibilityFields(item)]))
    rows.forEach((row) => {
      row.expand = { ...(row.expand ?? {}), participante_id: byId.get(row.participante_id) }
    })
  }
  if (collection === 'ingressos' && expand.includes('comprador_id')) {
    const ids = [...new Set(rows.map((row) => row.comprador_id).filter(Boolean))]
    const { data } =
      ids.length > 0 ? await db.from('compradores').select('*').in('id', ids) : { data: [] }
    const byId = new Map((data ?? []).map((item) => [item.id, withCompatibilityFields(item)]))
    rows.forEach((row) => {
      row.expand = { ...(row.expand ?? {}), comprador_id: byId.get(row.comprador_id) }
    })
  }
  if (collection === 'participantes' && expand.includes('ingresso_id')) {
    const ids = [...new Set(rows.map((row) => row.ingresso_id).filter(Boolean))]
    const { data } =
      ids.length > 0 ? await db.from('ingressos').select('*').in('id', ids) : { data: [] }
    const byId = new Map((data ?? []).map((item) => [item.id, withCompatibilityFields(item)]))
    rows.forEach((row) => {
      row.expand = { ...(row.expand ?? {}), ingresso_id: byId.get(row.ingresso_id) }
    })
  }
  if (collection === 'webhooks_log' && expand.includes('ingresso_id')) {
    const ids = [...new Set(rows.map((row) => row.ingresso_id).filter(Boolean))]
    const { data } =
      ids.length > 0 ? await db.from('ingressos').select('*').in('id', ids) : { data: [] }
    const byId = new Map((data ?? []).map((item) => [item.id, withCompatibilityFields(item)]))
    rows.forEach((row) => {
      row.expand = { ...(row.expand ?? {}), ingresso_id: byId.get(row.ingresso_id) }
    })
  }
  return rows
}

async function collectionApi(req: Request, collection: string, role: string) {
  if (!collections.has(collection)) throw new ApiError(404, 'COLLECTION_NOT_AVAILABLE')
  const input = await body<{
    action?: string
    id?: string
    page?: number
    perPage?: number
    data?: Record<string, unknown>
    options?: { filter?: string; sort?: string; expand?: string; fields?: string }
  }>(req)
  const action = input.action ?? 'getList'
  const options = input.options ?? {}
  const db = adminDb()

  if (['create', 'update', 'delete'].includes(action)) {
    if (role === 'viewer') throw new ApiError(403, 'READ_ONLY_ADMIN')
    if (!mutableCollections.has(collection)) {
      throw new ApiError(403, 'COLLECTION_MUTATION_NOT_ALLOWED')
    }
  }
  if (action === 'create') {
    await requireOperationalWrite(db)
    const { data, error } = await db
      .from(collection)
      .insert(input.data ?? {})
      .select()
      .single()
    if (error) throw new ApiError(400, error.message, error)
    return json(withCompatibilityFields(data))
  }
  if (action === 'update') {
    await requireOperationalWrite(db)
    const { data, error } = await db
      .from(collection)
      .update(input.data ?? {})
      .eq('id', input.id)
      .select()
      .single()
    if (error) throw new ApiError(400, error.message, error)
    return json(withCompatibilityFields(data))
  }
  if (action === 'delete') {
    await requireOperationalWrite(db)
    const { error } = await db.from(collection).delete().eq('id', input.id)
    if (error) throw new ApiError(400, error.message, error)
    return json({ success: true })
  }

  if (action === 'getFullList') {
    const data = await fetchAll((from, to) => {
      let query = db.from(collection).select('*')
      query = applyFilter(query, options.filter)
      query = applySort(query, options.sort)
      return query.range(from, to)
    })
    const rows = data.map(withCompatibilityFields)
    await addExpansions(collection, rows, options.expand)
    return json(rows)
  }

  const perPage = Math.min(Number(input.perPage ?? 30), 1000)
  const page = Math.max(Number(input.page ?? 1), 1)
  let query = db.from(collection).select('*', { count: 'exact' })
  query = applyFilter(query, options.filter)
  query = applySort(query, options.sort)
  query = query.range((page - 1) * perPage, page * perPage - 1)
  const { data, count, error } = await query
  if (error) throw new ApiError(400, error.message, error)

  const rows = (data ?? []).map(withCompatibilityFields)
  await addExpansions(collection, rows, options.expand)
  const totalItems = count ?? rows.length
  return json({
    page,
    perPage,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
    items: rows,
  })
}

async function stats() {
  const db = adminDb()
  const [
    buyers,
    tickets,
    filled,
    pending,
    errors,
    gold,
    goldFilled,
    platinum,
    platinumFilled,
    activity,
    filledRows,
  ] = await Promise.all([
    db.from('compradores').select('*', { count: 'exact', head: true }),
    db.from('ingressos').select('*', { count: 'exact', head: true }),
    db
      .from('ingressos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Pré-Credenciado'),
    db.from('ingressos').select('*', { count: 'exact', head: true }).eq('status', 'Pendente'),
    db.from('ingressos').select('*', { count: 'exact', head: true }).eq('status_webhook', 'erro'),
    db.from('ingressos').select('*', { count: 'exact', head: true }).eq('tipo_ingresso', 'GOLD'),
    db
      .from('ingressos')
      .select('*', { count: 'exact', head: true })
      .eq('tipo_ingresso', 'GOLD')
      .eq('status', 'Pré-Credenciado'),
    db
      .from('ingressos')
      .select('*', { count: 'exact', head: true })
      .eq('tipo_ingresso', 'PLATINUM'),
    db
      .from('ingressos')
      .select('*', { count: 'exact', head: true })
      .eq('tipo_ingresso', 'PLATINUM')
      .eq('status', 'Pré-Credenciado'),
    db
      .from('participantes')
      .select('id,nome_completo,email,created_at,ingresso_id')
      .order('created_at', { ascending: false })
      .limit(5),
    fetchAll((from, to) =>
      db
        .from('ingressos')
        .select('id,preenchido_em,created_at')
        .eq('status', 'Pré-Credenciado')
        .range(from, to),
    ),
  ])

  const allActivity = activity.data ?? []
  const hours = new Map<string, number>()
  const deltas: number[] = []
  let lastTimestamp = 0
  for (const row of filledRows) {
    if (!row.preenchido_em) continue
    const date = new Date(row.preenchido_em)
    if (Number.isNaN(date.getTime())) continue
    date.setMinutes(0, 0, 0)
    const key = date.toISOString()
    hours.set(key, (hours.get(key) ?? 0) + 1)
    lastTimestamp = Math.max(lastTimestamp, date.getTime())
    const created = new Date(row.created_at).getTime()
    const filledAt = new Date(row.preenchido_em).getTime()
    if (Number.isFinite(created) && filledAt >= created) deltas.push(filledAt - created)
  }
  const end = new Date(lastTimestamp || Date.now())
  end.setMinutes(0, 0, 0)
  const hourly = Array.from({ length: 48 }, (_, index) => {
    const hour = new Date(end.getTime() - (47 - index) * 60 * 60 * 1000)
    return { hora: hour.toISOString(), total: hours.get(hour.toISOString()) ?? 0 }
  })
  deltas.sort((left, right) => left - right)
  const average = deltas.length
    ? Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length)
    : 0
  const middle = Math.floor(deltas.length / 2)
  const median = deltas.length
    ? deltas.length % 2
      ? deltas[middle]
      : Math.round((deltas[middle - 1] + deltas[middle]) / 2)
    : 0
  const total = tickets.count ?? 0
  const filledCount = filled.count ?? 0
  const goldCount = gold.count ?? 0
  const platinumCount = platinum.count ?? 0
  return json({
    compradores_total: buyers.count ?? 0,
    total,
    preenchidos: filledCount,
    pendentes: pending.count ?? 0,
    erros: errors.count ?? 0,
    gold: {
      total: goldCount,
      preenchidos: goldFilled.count ?? 0,
      pendentes: goldCount - (goldFilled.count ?? 0),
    },
    platinum: {
      total: platinumCount,
      preenchidos: platinumFilled.count ?? 0,
      pendentes: platinumCount - (platinumFilled.count ?? 0),
    },
    activity: allActivity.map(withCompatibilityFields),
    por_hora: hourly,
    tempo_medio_ms: average,
    tempo_mediana_ms: median,
    credenciados_com_tempo: deltas.length,
  })
}

async function participantsSearch(req: Request) {
  const url = new URL(req.url)
  const page = Math.max(Number(url.searchParams.get('page') ?? 1), 1)
  const perPage = Math.min(Number(url.searchParams.get('perPage') ?? 20), 500)
  const search = (url.searchParams.get('q') ?? '').trim().replaceAll(',', ' ')
  const status = url.searchParams.get('status')
  const type = url.searchParams.get('tipo')
  const result = await rpc<Record<string, unknown>>('admin_participants_search', {
    p_query: search,
    p_status: status,
    p_type: type,
    p_page: page,
    p_per_page: perPage,
  })
  return json(result)
}

async function logs(req: Request) {
  const url = new URL(req.url)
  const page = Math.max(Number(url.searchParams.get('page') ?? 1), 1)
  const perPage = Math.min(Number(url.searchParams.get('perPage') ?? 20), 200)
  const filter = url.searchParams.get('filter') ?? 'todos'
  const db = adminDb()
  const [allLogs, allTickets] = await Promise.all([
    fetchAll((from, to) =>
      db.from('webhooks_log').select('*').order('created_at', { ascending: false }).range(from, to),
    ),
    fetchAll((from, to) =>
      db
        .from('ingressos')
        .select('id,pedido_id,inac_id,status_webhook')
        .range(from, to),
    ),
  ])
  const tickets = new Map(allTickets.map((ticket) => [ticket.id, ticket]))
  const manualEvents = new Set([
    'excluido_manual',
    'comprador_excluido',
    'editado_manual',
    'tipo_alterado',
    'api_criacao_comprador',
    'api_credenciamento',
    'api_reenvio_comprador',
    'api_reenvio_participante',
    'helpdesk_credenciamento',
    'helpdesk_edicao',
    'helpdesk_tipo_alterado',
    'helpdesk_qr',
    'helpdesk_qr_gerado',
    'helpdesk_erro',
    'helpdesk_novo_credenciamento',
    'helpdesk_reenvio_comprador',
    'helpdesk_reenvio_participante',
  ])
  const latest = new Map<string, any>()
  for (const row of allLogs) {
    if (row.ingresso_id && tickets.has(row.ingresso_id) && !latest.has(row.ingresso_id)) {
      latest.set(row.ingresso_id, row)
    }
  }
  const representative = [
    ...latest.values(),
    ...allLogs.filter(
      (row) =>
        manualEvents.has(row.evento) &&
        (!row.ingresso_id || !tickets.has(row.ingresso_id)),
    ),
  ]
  const isError = (row: any) => {
    const ticket = tickets.get(row.ingresso_id)
    return Boolean(
      ticket &&
        !ticket.inac_id &&
        (ticket.status_webhook === 'erro' ||
          (!ticket.status_webhook && (row.status < 200 || row.status >= 300))),
    )
  }
  const errorCount = representative.filter(isError).length
  const browserRows = allLogs.filter(
    (row) => row.evento === 'client_error' || row.evento === 'erro_navegador',
  )
  let selected =
    filter === 'helpdesk'
      ? allLogs.filter((row) => String(row.evento ?? '').startsWith('helpdesk_'))
      : filter === 'navegador'
        ? browserRows
        : representative.filter((row) => {
            if (filter === 'erros') return isError(row)
            if (filter === 'ok') return !isError(row)
            if (filter === 'manuais') return manualEvents.has(row.evento)
            return true
          })
  selected = selected.sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)),
  )
  const totalItems = selected.length
  const rows = selected
    .slice((page - 1) * perPage, page * perPage)
    .map((row) => {
      const ticket = tickets.get(row.ingresso_id)
      return {
        ...withCompatibilityFields(row),
        expand: {
          ingresso_id: ticket ? withCompatibilityFields(ticket) : undefined,
        },
      }
    })
  return json({
    items: rows,
    page,
    perPage,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
    errorCount,
    navegadorCount: browserRows.length,
  })
}

async function retryTicket(ticketId: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,participante_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket?.participante_id) throw new ApiError(404, 'TICKET_NOT_CREDENTIALLED')
  const result = await dispatchCredentialToInac(db, ticket.id, ticket.participante_id)
  return json({
    success: result.success,
    qrcode: result.qrCode,
    status: result.status,
    error: result.error,
  })
}

async function retryAll() {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: tickets } = await db
    .from('ingressos')
    .select('id,participante_id')
    .eq('status_webhook', 'erro')
    .is('inac_id', null)
    .not('participante_id', 'is', null)
    .limit(100)
  let ok = 0
  let failed = 0
  for (const ticket of tickets ?? []) {
    const result = await dispatchCredentialToInac(db, ticket.id, ticket.participante_id)
    if (result.success) ok += 1
    else failed += 1
  }
  return json({ tried: tickets?.length ?? 0, ok, failed })
}

async function createTicket(req: Request) {
  const input = await body<Record<string, unknown>>(req)
  await requireOperationalWrite()
  const result = await rpc<Record<string, unknown>>('create_admin_ticket', {
    p_buyer_id: input.comprador_id,
    p_ticket_type: input.tipo_ingresso,
    p_order_id: input.pedido_id || null,
  })
  return json(result)
}

async function createParticipant(req: Request) {
  const input = await body<Record<string, unknown>>(req)
  await requireOperationalWrite()
  const result = await rpc<{ ticketId: string; participantId: string }>('credential_ticket', {
    p_ticket_id: input.ingresso_id,
    p_payload: input,
    p_actor: 'admin',
  })
  const inac = await dispatchCredentialToInac(adminDb(), result.ticketId, result.participantId)
  return json({ success: true, qrcode: inac.qrCode, inac_ok: inac.success })
}

async function inviteLink(ticketId: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,status')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND')
  if (ticket.status !== 'Pendente') throw new ApiError(409, 'TICKET_ALREADY_CREDENTIALLED')
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  await db.from('links_participante').insert({
    ingresso_id: ticket.id,
    token,
    expira_em: expiresAt,
  })
  return json({ token, expiresAt })
}

async function buyerAccessLink(buyerId: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('id', buyerId)
    .maybeSingle()
  if (!buyer) throw new ApiError(404, 'BUYER_NOT_FOUND')
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
  await db.from('tokens_acesso').insert({ comprador_id: buyerId, token, expira_em: expiresAt })
  await auditEvent(db, {
    evento: 'admin_link_acesso',
    method: 'ADMIN',
    detalhe: `Link de acesso gerado no admin para ${buyer.nome} (${buyer.email})`,
    payload: { comprador_id: buyer.id, expira_em: expiresAt },
  })
  return json({
    token,
    email: buyer.email,
    nome: buyer.nome,
    expira_em: expiresAt,
  })
}

async function resendEssential(req: Request) {
  const input = await body<{ audience?: string; recipient_id?: string }>(req)
  const audience = String(input.audience ?? '')
  const recipientId = String(input.recipient_id ?? '')
  const db = adminDb()
  await requireOperationalWrite(db)
  const baseUrl = (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')

  if (audience === 'compradores') {
    const { data: buyer } = await db
      .from('compradores')
      .select('id,nome,email')
      .eq('id', recipientId)
      .maybeSingle()
    if (!buyer) throw new ApiError(404, 'BUYER_NOT_FOUND')
    const access = await buyerAccessLink(buyer.id)
    const accessBody = (await access.json()) as { token: string }
    const accessUrl = `${baseUrl}/acesso?token=${accessBody.token}`
    await sendEmail(db, {
      to: buyer.email,
      templateId: Deno.env.get('SENDGRID_BUYER_TEMPLATE_ID') || undefined,
      subject: 'Seu acesso ao Adapta Summit 2026',
      html: `<p><a href="${accessUrl}">Acesse seus ingressos</a>.</p>`,
      dynamicData: { nome: buyer.nome, access_url: accessUrl },
      idempotencyKey: `admin-buyer:${buyer.id}:${accessBody.token}`,
      operation: 'admin_resend_buyer',
    })
    return json({ success: true, enqueued: 1 })
  }

  if (audience === 'participantes') {
    const { data: participant } = await db
      .from('participantes')
      .select('id,ingresso_id,nome_completo,email')
      .eq('id', recipientId)
      .maybeSingle()
    if (!participant) throw new ApiError(404, 'PARTICIPANT_NOT_FOUND')
    const link = await createParticipantViewToken(db, participant.ingresso_id)
    const ticketUrl = `${baseUrl}/ingresso?token=${link.token}`
    await sendEmail(db, {
      to: participant.email,
      templateId: Deno.env.get('SENDGRID_PARTICIPANT_TEMPLATE_ID') || undefined,
      subject: 'Seu ingresso do Adapta Summit 2026',
      html: `<p><a href="${ticketUrl}">Visualize seu ingresso</a>.</p>`,
      dynamicData: { nome: participant.nome_completo, ticket_url: ticketUrl },
      idempotencyKey: `admin-participant:${participant.id}:${Date.now()}`,
      operation: 'admin_resend_participant',
    })
    return json({ success: true, enqueued: 1 })
  }

  throw new ApiError(400, 'AUDIENCE_INVALID')
}

async function deleteBuyer(buyerId: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('id', buyerId)
    .maybeSingle()
  if (!buyer) throw new ApiError(404, 'BUYER_NOT_FOUND')
  const { data: tickets } = await db
    .from('ingressos')
    .select('id,status,inac_id')
    .eq('comprador_id', buyerId)
  if ((tickets ?? []).some((ticket) => ticket.status === 'Pré-Credenciado' || ticket.inac_id)) {
    return json({
      success: false,
      error: 'O comprador possui ingresso credenciado e nao pode ser removido.',
    })
  }
  const ticketIds = (tickets ?? []).map((ticket) => ticket.id)
  if (ticketIds.length > 0) await db.from('ingressos').delete().in('id', ticketIds)
  const { error } = await db.from('compradores').delete().eq('id', buyerId)
  if (error) throw error
  await auditEvent(db, {
    evento: 'comprador_excluido',
    method: 'MANUAL',
    detalhe: `Comprador ${buyer.nome} (${buyer.email}) excluido manualmente pelo admin`,
    payload: {
      acao: 'exclusao_comprador',
      nome: buyer.nome,
      email: buyer.email,
      ingressos_removidos: ticketIds.length,
    },
    response: 'Sem INAC.',
  })
  return json({ success: true, removed_ingressos: ticketIds.length })
}

async function insights() {
  const db = adminDb()
  const [participantsResult, ticketsResult] = await Promise.all([
    db
      .from('participantes')
      .select(
        'id,tem_empresa,cargo,nicho,faturamento_anual,num_funcionarios,ia_uso_diario,ia_profundidade,ia_ferramentas,ia_desafio',
      )
      .limit(10000),
    db
      .from('ingressos')
      .select('participante_id,tipo_ingresso,preenchido_em,created_at')
      .not('participante_id', 'is', null)
      .limit(10000),
  ])
  if (participantsResult.error) throw participantsResult.error
  if (ticketsResult.error) throw ticketsResult.error

  const participants = participantsResult.data ?? []
  const tickets = ticketsResult.data ?? []
  const ticketByParticipant = new Map(
    tickets.map((ticket) => [
      ticket.participante_id,
      {
        type: ticket.tipo_ingresso,
        filledAt: ticket.preenchido_em || ticket.created_at,
      },
    ]),
  )
  const increment = (target: Record<string, number>, key: string | null | undefined) => {
    if (key) target[key] = (target[key] ?? 0) + 1
  }
  const tools: Array<[string, string[]]> = [
    ['Adapta', ['adapta one', 'adapta']],
    ['ChatGPT', ['chatgpt', 'chat gpt', 'gpt-', 'gpt ', 'openai']],
    ['Claude', ['claude']],
    ['Gemini', ['gemini', 'bard']],
    ['Copilot', ['copilot']],
    ['Perplexity', ['perplexity']],
    ['Midjourney', ['midjourney']],
    ['n8n', ['n8n']],
    ['Make', ['make.com', 'integromat']],
    ['Zapier', ['zapier']],
    ['Notion AI', ['notion']],
    ['Canva', ['canva']],
    ['DALL-E', ['dall-e', 'dalle', 'dall e']],
    ['Sora', ['sora']],
    ['ElevenLabs', ['elevenlabs', 'eleven labs']],
    ['HeyGen', ['heygen']],
    ['Runway', ['runway']],
    ['Suno', ['suno']],
    ['Cursor', ['cursor']],
    ['Grok', ['grok']],
    ['Llama', ['llama']],
    ['Manus', ['manus']],
    ['Lovable', ['lovable']],
    ['Gamma', ['gamma']],
  ]
  const themes: Array<[string, string[]]> = [
    [
      'Conhecimento / capacitação',
      ['conheci', 'conhecer', 'capacit', 'aprend', 'saber', 'treina', 'educa', 'formaç'],
    ],
    ['Equipe / cultura', ['equipe', 'time', 'pessoas', 'colaborad', 'cultura', 'engaj', 'resist']],
    ['Custo / investimento', ['custo', 'caro', 'investim', 'orçament', 'orcament', 'budget']],
    ['Tempo / prioridade', ['tempo', 'priorid', 'rotina', 'agenda', 'foco']],
    ['Dados', ['dados', ' data', 'informaç', 'base de', 'qualidade dos dados']],
    ['Integração / tecnologia', ['integr', 'sistema', 'tecnolog', 'implement', 'infra', 'api']],
    ['Confiança / segurança', ['seguranç', 'seguranc', 'privacid', 'confia', 'risco', 'lgpd']],
    [
      'Por onde começar / aplicação',
      ['começar', 'comecar', 'por onde', 'aplicar', 'caso de uso', 'onde usar', 'estratég'],
    ],
  ]

  const profile = { empresa: 0, profissional: 0 }
  const byTicketType = { GOLD: 0, PLATINUM: 0 }
  const roles: Record<string, number> = {}
  const segments: Record<string, number> = {}
  const revenue: Record<string, number> = {}
  const employees: Record<string, number> = {}
  const toolCounts: Record<string, number> = {}
  const challengeCounts: Record<string, number> = {}
  const byDay: Record<string, number> = {}
  const usageDistribution = [0, 0, 0, 0, 0]
  const depthDistribution = [0, 0, 0, 0, 0]
  const matrix = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0])
  const byType = {
    GOLD: { usageSum: 0, usageCount: 0, depthSum: 0, depthCount: 0 },
    PLATINUM: { usageSum: 0, usageCount: 0, depthSum: 0, depthCount: 0 },
  }
  let usageSum = 0
  let usageCount = 0
  let depthSum = 0
  let depthCount = 0
  let withoutTool = 0

  for (const participant of participants) {
    const hasCompany = participant.tem_empresa === true
    profile[hasCompany ? 'empresa' : 'profissional'] += 1
    if (hasCompany) {
      increment(roles, participant.cargo)
      increment(revenue, participant.faturamento_anual)
      increment(employees, participant.num_funcionarios)
    }
    increment(segments, participant.nicho)

    const ticket = ticketByParticipant.get(participant.id)
    const type = ticket?.type
    if (type === 'GOLD' || type === 'PLATINUM') byTicketType[type] += 1
    if (ticket?.filledAt) increment(byDay, String(ticket.filledAt).slice(0, 10))

    const usage = Number(participant.ia_uso_diario) || 0
    const depth = Number(participant.ia_profundidade) || 0
    if (usage >= 1 && usage <= 5) {
      usageDistribution[usage - 1] += 1
      usageSum += usage
      usageCount += 1
    }
    if (depth >= 1 && depth <= 5) {
      depthDistribution[depth - 1] += 1
      depthSum += depth
      depthCount += 1
    }
    if (usage >= 1 && usage <= 5 && depth >= 1 && depth <= 5) {
      matrix[usage - 1][depth - 1] += 1
    }
    if (type === 'GOLD' || type === 'PLATINUM') {
      const group = byType[type]
      if (usage >= 1 && usage <= 5) {
        group.usageSum += usage
        group.usageCount += 1
      }
      if (depth >= 1 && depth <= 5) {
        group.depthSum += depth
        group.depthCount += 1
      }
    }

    const toolText = (participant.ia_ferramentas || '').toLowerCase()
    if (!toolText.trim()) {
      withoutTool += 1
    } else {
      let matched = false
      for (const [name, keywords] of tools) {
        if (keywords.some((keyword) => toolText.includes(keyword))) {
          increment(toolCounts, name)
          matched = true
        }
      }
      if (!matched) increment(toolCounts, 'Outros')
    }

    const challengeText = (participant.ia_desafio || '').toLowerCase()
    for (const [name, keywords] of themes) {
      if (keywords.some((keyword) => challengeText.includes(keyword))) {
        increment(challengeCounts, name)
      }
    }
  }

  return json({
    total: participants.length,
    perfil: profile,
    por_tipo: byTicketType,
    cargo: roles,
    segmento: segments,
    faturamento: revenue,
    funcionarios: employees,
    ia: {
      uso_dist: usageDistribution,
      prof_dist: depthDistribution,
      uso_avg: usageCount ? usageSum / usageCount : 0,
      prof_avg: depthCount ? depthSum / depthCount : 0,
      matriz: matrix,
      por_tipo: {
        GOLD: {
          uso_avg: byType.GOLD.usageCount ? byType.GOLD.usageSum / byType.GOLD.usageCount : 0,
          prof_avg: byType.GOLD.depthCount ? byType.GOLD.depthSum / byType.GOLD.depthCount : 0,
        },
        PLATINUM: {
          uso_avg: byType.PLATINUM.usageCount
            ? byType.PLATINUM.usageSum / byType.PLATINUM.usageCount
            : 0,
          prof_avg: byType.PLATINUM.depthCount
            ? byType.PLATINUM.depthSum / byType.PLATINUM.depthCount
            : 0,
        },
      },
    },
    ferramentas: toolCounts,
    sem_ferramenta: withoutTool,
    desafios: challengeCounts,
    por_dia: byDay,
  })
}

async function syncInacUpgrades() {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: tickets, error } = await db
    .from('ingressos')
    .select('id,pedido_id,tipo_ingresso,inac_id,origem,participante_id')
    .eq('tipo_ingresso', 'PLATINUM')
    .ilike('origem', '%pending-inac-edit%')
    .limit(10)
  if (error) throw error

  let ok = 0
  let failed = 0
  const skipped: Array<{ id: string; motivo: string }> = []
  for (const ticket of tickets ?? []) {
    if (!ticket.inac_id || !ticket.participante_id) {
      skipped.push({
        id: ticket.id,
        motivo: !ticket.inac_id ? 'sem inac_id' : 'sem participante',
      })
      continue
    }
    const { data: participant } = await db
      .from('participantes')
      .select('id,nome_completo,email,cpf,telefone,nome_empresa,profissao')
      .eq('id', ticket.participante_id)
      .maybeSingle()
    if (!participant) {
      skipped.push({ id: ticket.id, motivo: 'participante nao encontrado' })
      continue
    }
    const result = await callInac(db, 'edit', ticket, participant, { category_id: 6125 })
    if (result.success) {
      ok += 1
      const origem = String(ticket.origem ?? '')
        .split(/\s+/)
        .filter((tag) => tag && tag !== 'pending-inac-edit')
        .join(' ')
      await db
        .from('ingressos')
        .update({ origem, status_webhook: 'enviado' })
        .eq('id', ticket.id)
    } else {
      failed += 1
      await db.from('ingressos').update({ status_webhook: 'erro' }).eq('id', ticket.id)
    }
    await auditEvent(db, {
      ingressoId: ticket.id,
      evento: result.success ? 'webhook_editado' : 'webhook_edicao_erro',
      detalhe: result.success
        ? `Categoria atualizada na INAC para Platinum (attendee ${ticket.inac_id})`
        : result.error || 'INAC recusou a edicao',
      status: result.status,
      payload: result.payload,
      response: JSON.stringify(result.response ?? '').slice(0, 2000),
    })
  }
  return json({ tried: tickets?.length ?? 0, ok, failed, skipped })
}

async function systemHealth() {
  const db = adminDb()
  const [{ data: health, error }, buyers, tickets, participants, tokens, links] = await Promise.all(
    [
      db.from('sync_health').select('*').single(),
      db.from('compradores').select('*', { count: 'exact', head: true }),
      db.from('ingressos').select('*', { count: 'exact', head: true }),
      db.from('participantes').select('*', { count: 'exact', head: true }),
      db.from('tokens_acesso').select('*', { count: 'exact', head: true }),
      db.from('links_participante').select('*', { count: 'exact', head: true }),
    ],
  )
  if (error) throw error
  return json({
    ...health,
    healthy:
      health.mode === 'standby' &&
      (health.failed_events ?? 0) === 0 &&
      (health.pending_events ?? 0) === 0 &&
      health.lag_seconds != null &&
      health.lag_seconds < 60,
    counts: {
      compradores: buyers.count ?? 0,
      ingressos: tickets.count ?? 0,
      participantes: participants.count ?? 0,
      tokens_acesso: tokens.count ?? 0,
      links_participante: links.count ?? 0,
    },
  })
}

async function activateFallback(req: Request, userId: string) {
  const input = await body<{ pocketbase_writes_blocked?: boolean }>(req)
  if (input.pocketbase_writes_blocked !== true) {
    throw new ApiError(409, 'POCKETBASE_WRITE_BLOCK_CONFIRMATION_REQUIRED')
  }
  const db = adminDb()
  const { data: health, error } = await db.from('sync_health').select('*').single()
  if (error) throw error
  if (
    health.last_sync_event_at == null ||
    health.lag_seconds == null ||
    health.lag_seconds >= 60 ||
    (health.failed_events ?? 0) > 0 ||
    (health.pending_events ?? 0) > 0
  ) {
    throw new ApiError(409, 'SYNC_NOT_READY_FOR_FAILOVER', health)
  }
  const state = await rpc('set_system_mode', {
    p_mode: 'active',
    p_user_id: userId,
    p_pocketbase_writes_blocked: true,
  })
  return json({ success: true, state, previousHealth: health })
}

Deno.serve((req) =>
  handler(req, async () => {
    const auth = await requireAdmin(req)
    const path = routePath(req, 'admin-api')

    if (req.method === 'POST' && path.startsWith('/backend/v1/admin/collections/')) {
      return collectionApi(req, path.split('/').at(-1) ?? '', auth.profile.role)
    }
    if (auth.profile.role === 'viewer' && req.method !== 'GET') {
      throw new ApiError(403, 'READ_ONLY_ADMIN')
    }
    if (req.method === 'GET' && path === '/backend/v1/admin/stats') return stats()
    if (req.method === 'GET' && path === '/backend/v1/admin/participants/search') {
      return participantsSearch(req)
    }
    if (req.method === 'GET' && path === '/backend/v1/admin/logs') return logs(req)
    if (req.method === 'GET' && path === '/backend/v1/admin/insights') return insights()
    if (req.method === 'GET' && path === '/backend/v1/admin/system/health') {
      return systemHealth()
    }
    if (req.method === 'POST' && path === '/backend/v1/admin/system/activate') {
      if (auth.profile.role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED')
      return activateFallback(req, auth.user.id)
    }
    if (req.method === 'POST' && path === '/backend/v1/admin/tickets') {
      return createTicket(req)
    }
    if (req.method === 'POST' && path === '/backend/v1/admin/participant/create') {
      return createParticipant(req)
    }
    if (req.method === 'POST' && path === '/backend/v1/admin/resend') {
      return resendEssential(req)
    }
    if (req.method === 'POST' && path === '/backend/v1/admin/retry-webhook-all') {
      return retryAll()
    }
    if (req.method === 'POST' && path === '/backend/v1/admin/sync-inac-upgrades') {
      return syncInacUpgrades()
    }

    const retry = path.match(/^\/backend\/v1\/admin\/retry-webhook\/([^/]+)$/)
    if (req.method === 'POST' && retry) return retryTicket(decodeURIComponent(retry[1]))
    const edit = path.match(/^\/backend\/v1\/admin\/tickets\/([^/]+)\/edit$/)
    if (req.method === 'POST' && edit) {
      await requireOperationalWrite()
      return json(
        await mutateCredentialledTicket(adminDb(), {
          ticketId: decodeURIComponent(edit[1]),
          operation: 'edit',
          actor: `admin:${auth.user.id}`,
          payload: await body(req),
        }),
      )
    }
    const changeType = path.match(/^\/backend\/v1\/admin\/tickets\/([^/]+)\/change-type$/)
    if (req.method === 'POST' && changeType) {
      await requireOperationalWrite()
      return json(
        await mutateCredentialledTicket(adminDb(), {
          ticketId: decodeURIComponent(changeType[1]),
          operation: 'change_type',
          actor: `admin:${auth.user.id}`,
          payload: await body(req),
        }),
      )
    }
    const removeTicket = path.match(/^\/backend\/v1\/admin\/tickets\/([^/]+)\/delete$/)
    if (req.method === 'POST' && removeTicket) {
      await requireOperationalWrite()
      const ticketId = decodeURIComponent(removeTicket[1])
      const { data: ticket } = await adminDb()
        .from('ingressos')
        .select('id,participante_id')
        .eq('id', ticketId)
        .maybeSingle()
      if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND')
      if (!ticket.participante_id) {
        const { error } = await adminDb().from('ingressos').delete().eq('id', ticketId)
        if (error) throw error
        return json({ success: true, inac_deleted: false })
      }
      const result = await mutateCredentialledTicket(adminDb(), {
        ticketId,
        operation: 'delete',
        actor: `admin:${auth.user.id}`,
      })
      return json({ ...result, inac_deleted: true })
    }
    const invitation = path.match(/^\/backend\/v1\/admin\/ticket\/([^/]+)\/invite-link$/)
    if (req.method === 'POST' && invitation) {
      return inviteLink(decodeURIComponent(invitation[1]))
    }
    const access = path.match(/^\/backend\/v1\/admin\/buyers\/([^/]+)\/access-link$/)
    if (req.method === 'POST' && access) {
      return buyerAccessLink(decodeURIComponent(access[1]))
    }
    const removeBuyer = path.match(/^\/backend\/v1\/admin\/buyers\/([^/]+)\/delete$/)
    if (req.method === 'POST' && removeBuyer) {
      return deleteBuyer(decodeURIComponent(removeBuyer[1]))
    }

    const dataParityResponse = await handleAdminDataParity(req, path)
    if (dataParityResponse) return dataParityResponse
    const dispatchParityResponse = await handleAdminDispatchParity(req, path)
    if (dispatchParityResponse) return dispatchParityResponse

    throw new ApiError(404, 'ROUTE_NOT_FOUND')
  }),
)

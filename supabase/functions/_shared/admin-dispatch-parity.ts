import { adminDb } from './db.ts'
import { ApiError, body, json } from './http.ts'
import {
  listBotConversaCustomFields,
  listBotConversaFlows,
  sendBotConversa,
} from './botconversa.ts'
import { auditEvent, requireOperationalWrite } from './operations.ts'
import { configuredSendGridTemplates } from './sendgrid.ts'

type AnyRow = Record<string, any>

async function paged<T = AnyRow>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
) {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await load(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

async function sendgridTemplates() {
  const key = Deno.env.get('SENDGRID_API_KEY') ?? ''
  if (!key) {
    const templates = configuredSendGridTemplates()
    return json({
      templates,
      mock: (Deno.env.get('SENDGRID_MODE') ?? 'mock') === 'mock',
      error: templates.length ? undefined : 'SENDGRID_API_KEY nao configurada',
    })
  }
  try {
    const response = await fetch(
      'https://api.sendgrid.com/v3/templates?generations=dynamic&page_size=200',
      { headers: { Authorization: `Bearer ${key}` } },
    )
    const payload = await response.json()
    if (!response.ok) throw new Error(`SendGrid HTTP ${response.status}`)
    const source = payload.result ?? payload.templates ?? []
    return json({
      templates: source
        .filter((template: AnyRow) => template?.id && template.generation !== 'legacy')
        .map((template: AnyRow) => ({ id: template.id, name: template.name || template.id })),
    })
  } catch (error) {
    return json({
      templates: [],
      error: error instanceof Error ? error.message : 'Falha ao consultar SendGrid',
    })
  }
}

async function sendgridPreview(templateId: string) {
  const key = Deno.env.get('SENDGRID_API_KEY') ?? ''
  if (!key) return json({ html: '', error: 'SENDGRID_API_KEY nao configurada' })
  try {
    const response = await fetch(`https://api.sendgrid.com/v3/templates/${templateId}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(`SendGrid HTTP ${response.status}`)
    const versions = Array.isArray(payload.versions) ? payload.versions : []
    const version =
      versions.find((item: AnyRow) => item.active === 1 || item.active === true) ?? versions[0]
    if (!version) return json({ html: '', error: 'Template sem versao ativa' })
    return json({
      html: version.html_content ?? '',
      subject: version.subject ?? '',
      name: payload.name ?? templateId,
    })
  } catch (error) {
    return json({
      html: '',
      error: error instanceof Error ? error.message : 'Falha ao consultar SendGrid',
    })
  }
}

async function recipientSearch(req: Request) {
  const input = await body<{ q?: string; audience?: string }>(req)
  const query = String(input.q ?? '')
    .trim()
    .replace(/[,%]/g, ' ')
  if (!query) return json({ results: [] })
  const participant = input.audience === 'participantes'
  const table = participant ? 'participantes' : 'compradores'
  const name = participant ? 'nome_completo' : 'nome'
  const { data, error } = await adminDb()
    .from(table)
    .select(`id,${name},email`)
    .or(`${name}.ilike.%${query}%,email.ilike.%${query}%`)
    .order(name)
    .limit(10)
  if (error) throw error
  return json({
    results: (data ?? []).map((row) => ({
      id: row.id,
      nome: row[name] ?? '',
      email: row.email,
    })),
  })
}

async function pendingBuyerIds() {
  const tickets = await paged<AnyRow>((from, to) =>
    adminDb().from('ingressos').select('comprador_id').eq('status', 'Pendente').range(from, to),
  )
  return [...new Set(tickets.map((ticket) => ticket.comprador_id))]
}

async function emailRecipients(input: AnyRow) {
  const db = adminDb()
  const cluster = String(input.cluster ?? 'todos')
  const participant = cluster.startsWith('participantes') || input.audience === 'participantes'
  if (cluster === 'individual') {
    const table = participant ? 'participantes' : 'compradores'
    const name = participant ? 'nome_completo' : 'nome'
    const { data, error } = await db
      .from(table)
      .select(`id,${name},email`)
      .eq('id', String(input.recipient_id ?? ''))
      .maybeSingle()
    if (error) throw error
    return data
      ? [
          {
            id: data.id,
            nome: data[name] ?? '',
            email: data.email,
            audience: participant ? 'participantes' : 'compradores',
          },
        ]
      : []
  }

  if (participant) {
    return paged<AnyRow>((from, to) => {
      let query = db.from('participantes').select('id,nome_completo,email').neq('email', '')
      if (cluster === 'participantes_recentes') {
        const days = Math.min(Math.max(Number(input.dias ?? 7) || 7, 1), 365)
        query = query.gte('created_at', new Date(Date.now() - days * 86400000).toISOString())
      }
      return query.order('created_at').range(from, to)
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        nome: row.nome_completo,
        email: row.email,
        audience: 'participantes',
      })),
    )
  }

  if (cluster === 'pendentes') {
    const ids = await pendingBuyerIds()
    const rows: AnyRow[] = []
    for (let index = 0; index < ids.length; index += 500) {
      const { data, error } = await db
        .from('compradores')
        .select('id,nome,email')
        .in('id', ids.slice(index, index + 500))
        .neq('email', '')
      if (error) throw error
      rows.push(...(data ?? []))
    }
    return rows.map((row) => ({ ...row, audience: 'compradores' }))
  }

  return paged<AnyRow>((from, to) =>
    db
      .from('compradores')
      .select('id,nome,email')
      .neq('email', '')
      .order('created_at')
      .range(from, to),
  ).then((rows) => rows.map((row) => ({ ...row, audience: 'compradores' })))
}

async function emailPreview(req: Request) {
  const input = await body<AnyRow>(req)
  return json({ count: (await emailRecipients(input)).length })
}

async function insertChunks(table: string, rows: AnyRow[], size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await adminDb()
      .from(table)
      .insert(rows.slice(index, index + size))
    if (error) throw error
  }
}

async function updateRecipientEmailQueue(recipients: AnyRow[], dispatch: AnyRow) {
  const grouped = {
    compradores: recipients.filter((row) => row.audience === 'compradores').map((row) => row.id),
    participantes: recipients
      .filter((row) => row.audience === 'participantes')
      .map((row) => row.id),
  }
  for (const [table, ids] of Object.entries(grouped)) {
    for (let index = 0; index < ids.length; index += 500) {
      const { error } = await adminDb()
        .from(table)
        .update({
          acesso_status: 'na_fila',
          acesso_disparo_id: dispatch.id,
          acesso_template_id: dispatch.template_id,
          acesso_tentativas: 0,
          acesso_erro: null,
          acesso_claim: null,
        })
        .in('id', ids.slice(index, index + 500))
      if (error) throw error
    }
  }
}

async function emailEnqueue(req: Request) {
  await requireOperationalWrite()
  const input = await body<AnyRow>(req)
  const templateId = String(input.template_id ?? '').trim()
  if (!templateId.startsWith('d-')) throw new ApiError(400, 'Selecione um template valido')
  const recipients = await emailRecipients(input)
  const audience =
    recipients[0]?.audience ??
    (String(input.cluster ?? '').startsWith('participantes') ? 'participantes' : 'compradores')
  const db = adminDb()
  const { data: dispatch, error } = await db
    .from('disparos')
    .insert({
      template_id: templateId,
      template_nome: String(input.template_nome ?? ''),
      cluster: String(input.cluster ?? 'todos'),
      nome: String(input.nome ?? ''),
      audience,
      total: recipients.length,
      status: recipients.length > 0 ? 'em_andamento' : 'concluido',
    })
    .select()
    .single()
  if (error) throw error
  await insertChunks(
    'envios',
    recipients.map((recipient) => ({
      disparo_id: dispatch.id,
      comprador_id: recipient.audience === 'compradores' ? recipient.id : null,
      participante_id: recipient.audience === 'participantes' ? recipient.id : null,
      nome: recipient.nome,
      email: recipient.email,
      status: 'na_fila',
    })),
  )
  await updateRecipientEmailQueue(recipients, dispatch)
  await auditEvent(db, {
    evento: 'admin_disparo_email_enfileirado',
    detalhe: `${recipients.length} destinatario(s) enfileirado(s)`,
    payload: { disparo_id: dispatch.id, cluster: dispatch.cluster, template_id: templateId },
  })
  return json({ enqueued: recipients.length, disparo_id: dispatch.id })
}

async function retryEmailDispatch(id: string) {
  await requireOperationalWrite()
  const db = adminDb()
  const { data, error } = await db
    .from('envios')
    .update({ status: 'na_fila', erro: null, claim: null, proxima_tentativa_em: null })
    .eq('disparo_id', id)
    .eq('status', 'erro')
    .select('id')
  if (error) throw error
  await db.from('disparos').update({ status: 'em_andamento', erros: 0 }).eq('id', id)
  return json({ requeued: data?.length ?? 0 })
}

async function botCollection(kind: 'flows' | 'fields') {
  try {
    const result =
      kind === 'flows' ? await listBotConversaFlows() : await listBotConversaCustomFields()
    const payload = result.data as AnyRow
    const rows =
      payload.results ?? payload[kind] ?? payload.data ?? (Array.isArray(payload) ? payload : [])
    return json({ ok: true, [kind]: rows })
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'BotConversa indisponivel',
      [kind]: [],
    })
  }
}

async function whatsappRecipients(input: AnyRow) {
  const db = adminDb()
  if (String(input.cluster ?? 'todos') === 'individual') {
    const { data, error } = await db
      .from('compradores')
      .select('id,nome,email,telefone,documento')
      .eq('id', String(input.recipient_id ?? ''))
      .maybeSingle()
    if (error) throw error
    return data ? [data] : []
  }
  if (String(input.cluster ?? 'todos') === 'pendentes') {
    const ids = await pendingBuyerIds()
    const rows: AnyRow[] = []
    for (let index = 0; index < ids.length; index += 500) {
      const { data, error } = await db
        .from('compradores')
        .select('id,nome,email,telefone,documento')
        .in('id', ids.slice(index, index + 500))
      if (error) throw error
      rows.push(...(data ?? []))
    }
    return rows
  }
  return paged<AnyRow>((from, to) =>
    db
      .from('compradores')
      .select('id,nome,email,telefone,documento')
      .order('created_at')
      .range(from, to),
  )
}

async function whatsappPreview(req: Request) {
  const input = await body<AnyRow>(req)
  return json({ count: (await whatsappRecipients(input)).length })
}

function validMapping(input: unknown) {
  if (!Array.isArray(input)) return []
  return input
    .filter((row) => row && row.field_id && row.source)
    .map((row) => ({
      field_id: String(row.field_id),
      source: String(row.source),
      value: String(row.value ?? ''),
    }))
}

async function createWhatsappDispatch(input: AnyRow, recipients: AnyRow[]) {
  const flow = String(input.flow ?? 'PRE')
  if (flow !== 'PRE' && !/^\d+$/.test(flow)) throw new ApiError(400, 'FLOW_INVALID')
  const mapping = flow === 'PRE' ? [] : validMapping(input.mapping)
  const { data, error } = await adminDb()
    .from('disparos_wa')
    .insert({
      nome: String(input.nome ?? ''),
      cluster: String(input.cluster ?? 'todos'),
      total: recipients.length,
      status: recipients.length > 0 ? 'em_andamento' : 'concluido',
      flow,
      flow_nome: String(input.flow_nome ?? ''),
      mapping,
    })
    .select()
    .single()
  if (error) throw error
  for (let index = 0; index < recipients.length; index += 500) {
    const { error: updateError } = await adminDb()
      .from('compradores')
      .update({
        wa_status: 'na_fila',
        wa_disparo_id: data.id,
        wa_tentativas: 0,
        wa_erro: null,
        wa_claim: null,
      })
      .in(
        'id',
        recipients.slice(index, index + 500).map((buyer) => buyer.id),
      )
    if (updateError) throw updateError
  }
  return data
}

async function whatsappEnqueue(req: Request) {
  await requireOperationalWrite()
  const input = await body<AnyRow>(req)
  const recipients = await whatsappRecipients(input)
  const dispatch = await createWhatsappDispatch(input, recipients)
  await auditEvent(adminDb(), {
    evento: 'admin_disparo_whatsapp_enfileirado',
    detalhe: `${recipients.length} comprador(es) enfileirado(s)`,
    payload: { disparo_id: dispatch.id, cluster: dispatch.cluster, flow: dispatch.flow },
  })
  return json({ enqueued: recipients.length, disparo_id: dispatch.id })
}

async function retryWhatsappDispatch(id: string) {
  await requireOperationalWrite()
  const db = adminDb()
  const { data, error } = await db
    .from('compradores')
    .update({ wa_status: 'na_fila', wa_erro: null, wa_claim: null })
    .eq('wa_disparo_id', id)
    .eq('wa_status', 'erro')
    .select('id')
  if (error) throw error
  await db.from('disparos_wa').update({ status: 'em_andamento', erros: 0 }).eq('id', id)
  return json({ requeued: data?.length ?? 0 })
}

async function ensureBuyerToken(buyerId: string) {
  const db = adminDb()
  const { data: existing } = await db
    .from('tokens_acesso')
    .select('token')
    .eq('comprador_id', buyerId)
    .eq('usado', false)
    .gt('expira_em', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing?.token) return existing.token
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const { error } = await db.from('tokens_acesso').insert({
    comprador_id: buyerId,
    token,
    expira_em: new Date(Date.now() + 60 * 86400000).toISOString(),
  })
  if (error) throw error
  return token
}

async function whatsappIndividual(req: Request) {
  await requireOperationalWrite()
  const input = await body<AnyRow>(req)
  input.cluster = 'individual'
  const recipients = await whatsappRecipients(input)
  if (recipients.length !== 1) throw new ApiError(404, 'COMPRADOR_NAO_ENCONTRADO')
  const buyer = recipients[0]
  const dispatch = await createWhatsappDispatch(input, recipients)
  const { data: latestTicket } = await adminDb()
    .from('ingressos')
    .select('pedido_id')
    .eq('comprador_id', buyer.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const token = await ensureBuyerToken(buyer.id)
  await adminDb()
    .from('compradores')
    .update({ wa_status: 'enviando', wa_tentativas: 1 })
    .eq('id', buyer.id)
  const result = await sendBotConversa(adminDb(), {
    buyerId: buyer.id,
    nome: buyer.nome,
    email: buyer.email,
    telefone: buyer.telefone,
    documento: buyer.documento,
    pedidoId: latestTicket?.pedido_id ?? '',
    flow: dispatch.flow,
    mapping: dispatch.mapping,
    token,
    dispatchId: dispatch.id,
    attempt: 1,
  })
  await adminDb().rpc('complete_whatsapp_dispatch', {
    p_buyer_id: buyer.id,
    p_success: result.success,
    p_error: result.success ? null : result.error,
  })
  return json(result.success ? { success: true, status: result.status } : result)
}

export async function handleAdminDispatchParity(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (req.method === 'GET' && path === '/backend/v1/admin/sendgrid/templates') {
    return sendgridTemplates()
  }
  const templatePreview = path.match(
    /^\/backend\/v1\/admin\/sendgrid\/templates\/([^/]+)\/preview$/,
  )
  if (req.method === 'GET' && templatePreview) {
    return sendgridPreview(decodeURIComponent(templatePreview[1]))
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/dispatch/search-recipient') {
    return recipientSearch(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/dispatch/preview') {
    return emailPreview(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/dispatch/enqueue') {
    return emailEnqueue(req)
  }
  const emailRetry = path.match(/^\/backend\/v1\/admin\/dispatch\/([^/]+)\/retry$/)
  if (req.method === 'POST' && emailRetry) {
    return retryEmailDispatch(decodeURIComponent(emailRetry[1]))
  }
  if (req.method === 'GET' && path === '/backend/v1/admin/whatsapp/flows') {
    return botCollection('flows')
  }
  if (req.method === 'GET' && path === '/backend/v1/admin/whatsapp/custom-fields') {
    return botCollection('fields')
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/whatsapp/preview') {
    return whatsappPreview(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/whatsapp/enqueue') {
    return whatsappEnqueue(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/whatsapp/send-individual') {
    return whatsappIndividual(req)
  }
  const whatsappRetry = path.match(/^\/backend\/v1\/admin\/whatsapp\/([^/]+)\/retry$/)
  if (req.method === 'POST' && whatsappRetry) {
    return retryWhatsappDispatch(decodeURIComponent(whatsappRetry[1]))
  }
  return null
}

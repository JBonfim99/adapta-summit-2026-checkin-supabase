import { adminDb, rpc } from './db.ts'
import { ApiError, body, json } from './http.ts'
import { sendEmail } from './sendgrid.ts'
import {
  auditEvent,
  cpfDigits,
  createParticipantViewToken,
  normalizeEmail,
  requireOperationalWrite,
  validCpf,
  validPhone,
} from './operations.ts'
import { dispatchCredentialToInac } from './ticket-operations.ts'

const appUrl = () => (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')

async function externalAuthorized(req: Request) {
  const expected = Deno.env.get('EXTERNAL_API_KEY') ?? ''
  const received = req.headers.get('X-Api-Key') ?? ''
  if (!expected || expected.length !== received.length) throw new ApiError(401, 'INVALID_API_KEY')
  const encoder = new TextEncoder()
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
  ])
  const a = new Uint8Array(left)
  const b = new Uint8Array(right)
  if (a.some((value, index) => value !== b[index])) throw new ApiError(401, 'INVALID_API_KEY')
}

async function sendBuyerAccess(
  buyer: { id: string; nome: string; email: string },
  operation: string,
  templateId?: string,
) {
  const db = adminDb()
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await db.from('tokens_acesso').insert({
    comprador_id: buyer.id,
    token,
    expira_em: expiresAt,
  })
  if (error) throw error
  const accessUrl = `${appUrl()}/acesso?token=${encodeURIComponent(token)}`
  await sendEmail(db, {
    to: buyer.email,
    templateId: templateId || Deno.env.get('SENDGRID_BUYER_TEMPLATE_ID') || undefined,
    subject: 'Seu acesso ao Adapta Summit 2026',
    html: `<p><a href="${accessUrl}">Acesse seus ingressos</a>.</p>`,
    dynamicData: {
      nome: buyer.nome,
      firstname: buyer.nome.split(' ')[0] || buyer.nome,
      token,
      access_url: accessUrl,
    },
    idempotencyKey: `${operation}:${buyer.id}:${token}`,
    operation,
  })
  return { token, expiresAt }
}

async function sendParticipantTicket(
  participant: { id: string; ingresso_id: string; nome_completo: string; email: string },
  operation: string,
) {
  const db = adminDb()
  const { token } = await createParticipantViewToken(db, participant.ingresso_id)
  const ticketUrl = `${appUrl()}/ingresso?token=${encodeURIComponent(token)}`
  await sendEmail(db, {
    to: participant.email,
    templateId: Deno.env.get('SENDGRID_PARTICIPANT_TEMPLATE_ID') || undefined,
    subject: 'Seu ingresso do Adapta Summit 2026',
    html: `<p><a href="${ticketUrl}">Visualize seu ingresso</a>.</p>`,
    dynamicData: {
      nome: participant.nome_completo,
      firstname: participant.nome_completo.split(' ')[0] || participant.nome_completo,
      token,
      ticket_url: ticketUrl,
    },
    idempotencyKey: `${operation}:${participant.id}:${token}`,
    operation,
  })
  return { token }
}

async function courtesyInfo(token: string) {
  const { data, error } = await adminDb()
    .from('cortesias')
    .select('anfitriao,tipo_ingresso,ativo,limite,usados')
    .eq('token', token)
    .maybeSingle()
  if (error || !data) throw new ApiError(404, 'Convite nao encontrado')
  return json({
    anfitriao: data.anfitriao,
    tipo_ingresso: data.tipo_ingresso,
    ativo: data.ativo,
    esgotado: data.limite > 0 && data.usados >= data.limite,
    restantes: data.limite > 0 ? Math.max(0, data.limite - data.usados) : null,
  })
}

async function registerCourtesy(req: Request) {
  await requireOperationalWrite()
  const input = await body<Record<string, unknown>>(req)
  const name = String(input.nome_completo ?? '').trim()
  const email = normalizeEmail(input.email)
  if (name.length < 3) throw new ApiError(400, 'Informe o nome completo.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError(400, 'E-mail invalido.')
  }
  if (!validCpf(input.cpf)) throw new ApiError(400, 'CPF invalido.')
  if (!validPhone(input.telefone)) throw new ApiError(400, 'Informe um telefone valido com DDD.')
  if (!input.terms_accepted) {
    throw new ApiError(400, 'E necessario aceitar a autorizacao de uso de imagem e dados.')
  }

  const result = await rpc<{
    ticketId: string
    participantId: string
    pedidoId: string
    tipoIngresso: string
    nomeCompleto: string
  }>('register_courtesy', {
    p_token: String(input.token ?? ''),
    p_payload: {
      ...input,
      nome_completo: name,
      email,
      cpf: cpfDigits(input.cpf),
    },
  })
  const db = adminDb()
  const inac = await dispatchCredentialToInac(db, result.ticketId, result.participantId)
  return json({
    success: true,
    qrcode: inac.qrCode ?? '',
    inac_ok: inac.success,
    pedido_id: result.pedidoId,
    tipo_ingresso: result.tipoIngresso,
    nome_completo: result.nomeCompleto,
  })
}

function guruItems(payload: Record<string, any>) {
  const source = Array.isArray(payload.items)
    ? payload.items
    : payload.product
      ? [payload.product]
      : []
  const items: Array<{ type: 'GOLD' | 'PLATINUM'; quantity: number }> = []
  for (const item of source) {
    const name = `${item?.name ?? ''} ${item?.offer?.name ?? ''}`.toLowerCase()
    const type = name.includes('platinum')
      ? 'PLATINUM'
      : name.includes('gold')
        ? 'GOLD'
        : null
    if (!type) continue
    items.push({
      type,
      quantity: Math.min(Math.max(Number(item?.quantity ?? 1) || 1, 1), 100),
    })
  }
  return items
}

async function guruWebhook(req: Request) {
  await requireOperationalWrite()
  const input = await body<Record<string, any>>(req)
  const status = String(input.status ?? '').toLowerCase()
  const transactionId = String(input.payment?.marketplace_id ?? input.id ?? '').trim()
  if (!transactionId) return json({ ignored: true, reason: 'sem transacao_id' })
  if (status !== 'approved') {
    return json({ ignored: true, status, transacao_id: transactionId })
  }
  const contact = input.contact ?? input.customer ?? {}
  const email = normalizeEmail(contact.email)
  if (!email) return json({ ignored: true, reason: 'sem email', transacao_id: transactionId })
  const buyer = {
    nome: String(contact.name ?? contact.nome ?? '').trim(),
    documento: cpfDigits(contact.doc ?? contact.document ?? contact.cpf),
    uf: String(contact.address?.state ?? contact.uf ?? ''),
    cidade: String(contact.address?.city ?? contact.cidade ?? ''),
    telefone: String(contact.phone ?? contact.telefone ?? ''),
  }
  let result
  try {
    result = await rpc<Record<string, any>>('process_guru_order', {
      p_transaction_id: transactionId,
      p_email: email,
      p_buyer: buyer,
      p_items: guruItems(input),
      p_payload: input,
    })
  } catch (error) {
    const { data: existing } = await adminDb()
      .from('pedidos_guru')
      .select('id')
      .eq('transacao_id', transactionId)
      .maybeSingle()
    if (existing) return json({ duplicate: true, transacao_id: transactionId })
    throw error
  }
  if (result.duplicate) return json(result)
  if (Number(result.ingressos ?? 0) > 0) {
    try {
      const db = adminDb()
      const templateId = Deno.env.get('SENDGRID_BUYER_TEMPLATE_ID') ?? ''
      if (!templateId) throw new Error('SENDGRID_BUYER_TEMPLATE_ID_NOT_CONFIGURED')
      const { data: dispatch, error: dispatchError } = await db
        .from('disparos')
        .insert({
          template_id: templateId,
          template_nome: 'Acesso do comprador - Guru',
          cluster: 'individual',
          nome: `Guru ${transactionId}`,
          audience: 'compradores',
          total: 1,
        })
        .select('id')
        .single()
      if (dispatchError) throw dispatchError
      const { error: queueError } = await db.from('envios').insert({
        disparo_id: dispatch.id,
        comprador_id: result.comprador_id,
        nome: result.nome,
        email: result.email,
        status: 'na_fila',
      })
      if (queueError) throw queueError
      await Promise.all([
        db
          .from('compradores')
          .update({
            acesso_status: 'na_fila',
            acesso_disparo_id: dispatch.id,
            acesso_template_id: templateId,
            acesso_tentativas: 0,
            acesso_erro: null,
          })
          .eq('id', result.comprador_id),
        db
          .from('pedidos_guru')
          .update({ email_status: 'na_fila' })
          .eq('transacao_id', transactionId),
      ])
      result.email_enfileirado = true
    } catch (error) {
      await adminDb()
        .from('pedidos_guru')
        .update({
          email_status: `erro:${error instanceof Error ? error.message : 'SEND_FAILED'}`.slice(0, 200),
        })
        .eq('transacao_id', transactionId)
      result.email_enfileirado = false
    }
  }
  return json({ ok: true, ...result })
}

async function externalBuyers(req: Request) {
  await externalAuthorized(req)
  const url = new URL(req.url)
  const page = Math.max(Number(url.searchParams.get('page') ?? 1), 1)
  const perPage = Math.min(Math.max(Number(url.searchParams.get('perPage') ?? 20), 1), 100)
  const db = adminDb()
  let query = db.from('compradores').select('*', { count: 'exact' })
  const email = normalizeEmail(url.searchParams.get('email'))
  const cpf = cpfDigits(url.searchParams.get('cpf'))
  const name = String(url.searchParams.get('nome') ?? '').trim()
  if (email) query = query.eq('email_normalized', email)
  if (cpf) query = query.eq('documento', cpf)
  if (name) query = query.ilike('nome', `%${name.replaceAll(',', ' ')}%`)
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1)
  if (error) throw error
  const buyerIds = (data ?? []).map((buyer) => buyer.id)
  const { data: tickets } =
    buyerIds.length > 0
      ? await db.from('ingressos').select('*').in('comprador_id', buyerIds)
      : { data: [] }
  return json({
    page,
    per_page: perPage,
    total: count ?? 0,
    count: data?.length ?? 0,
    compradores: (data ?? []).map((buyer) => {
      const buyerTickets = (tickets ?? [])
        .filter((ticket) => ticket.comprador_id === buyer.id)
        .map((ticket) => ({
          ...ticket,
          disponivel: ticket.status === 'Pendente',
        }))
      return {
        ...buyer,
        ingressos: buyerTickets,
        ingressos_disponiveis: buyerTickets.filter((ticket) => ticket.disponivel).length,
      }
    }),
  })
}

async function externalParticipants(req: Request) {
  await externalAuthorized(req)
  const url = new URL(req.url)
  const page = Math.max(Number(url.searchParams.get('page') ?? 1), 1)
  const perPage = Math.min(Math.max(Number(url.searchParams.get('perPage') ?? 20), 1), 100)
  const db = adminDb()
  let query = db
    .from('participantes')
    .select('*,ingressos!participantes_ingresso_id_fkey(*)', { count: 'exact' })
  const email = normalizeEmail(url.searchParams.get('email'))
  const cpf = cpfDigits(url.searchParams.get('cpf'))
  const name = String(url.searchParams.get('nome') ?? '').trim()
  if (email) query = query.eq('email_normalized', email)
  if (cpf) query = query.eq('cpf_normalized', cpf)
  if (name) query = query.ilike('nome_completo', `%${name.replaceAll(',', ' ')}%`)
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1)
  if (error) throw error
  return json({
    page,
    per_page: perPage,
    total: count ?? 0,
    count: data?.length ?? 0,
    participantes: (data ?? []).map((participant: Record<string, any>) => {
      const ticket = Array.isArray(participant.ingressos)
        ? participant.ingressos[0]
        : participant.ingressos
      const { ingressos: _relation, ...fields } = participant
      return { ...fields, ingresso: ticket ?? null }
    }),
  })
}

async function externalCreateBuyer(req: Request) {
  await externalAuthorized(req)
  await requireOperationalWrite()
  const input = await body<Record<string, unknown>>(req)
  const email = normalizeEmail(input.email)
  if (!email) throw new ApiError(400, 'email obrigatorio')
  const counts: Array<[string, number]> = [
    ['GOLD', Number(input.qtd_gold ?? 0)],
    ['PLATINUM', Number(input.qtd_platinum ?? 0)],
  ]
  if (counts.every(([, count]) => count <= 0)) {
    throw new ApiError(400, 'Informe ao menos um ingresso.')
  }
  const db = adminDb()
  let { data: buyer } = await db
    .from('compradores')
    .select('*')
    .eq('email_normalized', email)
    .maybeSingle()
  if (buyer) {
    const { data, error } = await db
      .from('compradores')
      .update({
        nome: String(input.nome ?? buyer.nome),
        documento: cpfDigits(input.documento) || buyer.documento,
        uf: String(input.uf ?? buyer.uf),
        cidade: String(input.cidade ?? buyer.cidade),
        telefone: String(input.telefone ?? buyer.telefone),
      })
      .eq('id', buyer.id)
      .select()
      .single()
    if (error) throw error
    buyer = data
  } else {
    const { data, error } = await db
      .from('compradores')
      .insert({
        nome: String(input.nome ?? email),
        email,
        documento: cpfDigits(input.documento),
        uf: String(input.uf ?? ''),
        cidade: String(input.cidade ?? ''),
        telefone: String(input.telefone ?? ''),
      })
      .select()
      .single()
    if (error) throw error
    buyer = data
  }
  const createdTickets: Array<{ id: string; pedido_id: string; tipo_ingresso: string }> = []
  if (!buyer) throw new ApiError(500, 'COMPRADOR_NAO_CRIADO')
  for (const [type, rawCount] of counts) {
    const count = Math.min(Math.max(rawCount || 0, 0), 100)
    for (let index = 0; index < count; index += 1) {
      const ticket = await rpc<Record<string, any>>('create_admin_ticket', {
        p_buyer_id: buyer.id,
        p_ticket_type: type,
        p_order_id: null,
        p_origin: 'api',
      })
      createdTickets.push({
        id: ticket.id,
        pedido_id: ticket.pedido_id,
        tipo_ingresso: type,
      })
    }
  }
  let emailResult: Record<string, unknown>
  try {
    emailResult = { enviado: true, ...(await sendBuyerAccess(buyer, 'api_create_buyer')) }
  } catch (error) {
    emailResult = { enviado: false, erro: error instanceof Error ? error.message : 'SEND_FAILED' }
  }
  await auditEvent(db, {
    evento: 'api_criacao_comprador',
    detalhe: `Comprador ${buyer.email} criado/atualizado pela API com ${createdTickets.length} ingresso(s)`,
    payload: { comprador_id: buyer.id, ingressos: createdTickets.map((ticket) => ticket.id) },
  })
  return json({
    success: true,
    comprador_id: buyer.id,
    comprador: buyer,
    ingressos: createdTickets,
    ingressos_criados: createdTickets.length,
    ingresso_ids: createdTickets.map((ticket) => ticket.id),
    email: emailResult,
  })
}

async function externalCredential(req: Request) {
  await externalAuthorized(req)
  await requireOperationalWrite()
  const input = await body<Record<string, unknown>>(req)
  const db = adminDb()
  let query = db.from('ingressos').select('id')
  if (input.ingresso_id) query = query.eq('id', String(input.ingresso_id))
  else if (input.pedido_id) query = query.eq('pedido_id', String(input.pedido_id))
  else throw new ApiError(400, 'pedido_id ou ingresso_id obrigatorio')
  const { data: ticket } = await query.maybeSingle()
  if (!ticket) throw new ApiError(404, 'Ingresso nao encontrado')
  const result = await rpc<{ ticketId: string; participantId: string }>('credential_ticket', {
    p_ticket_id: ticket.id,
    p_payload: input,
    p_actor: 'external_api',
  })
  const inac = await dispatchCredentialToInac(db, result.ticketId, result.participantId)
  await auditEvent(db, {
    ingressoId: result.ticketId,
    evento: 'api_credenciamento',
    detalhe: `Credenciamento realizado pela API externa`,
    status: inac.success ? 200 : inac.status,
    payload: { participante_id: result.participantId },
    response: inac.success ? 'INAC /add OK' : inac.error,
  })
  return json({
    success: true,
    ingresso_id: result.ticketId,
    participante_id: result.participantId,
    inac: {
      credenciado: inac.success,
      qrcode: inac.qrCode ?? '',
      erro: inac.success ? '' : inac.error,
    },
    qrcode: inac.qrCode ?? '',
    inac_ok: inac.success,
    inac_error: inac.error,
  })
}

async function externalResendBuyer(req: Request) {
  await externalAuthorized(req)
  await requireOperationalWrite()
  const input = await body<Record<string, unknown>>(req)
  const db = adminDb()
  let query = db.from('compradores').select('id,nome,email')
  if (input.comprador_id) query = query.eq('id', String(input.comprador_id))
  else if (input.email) query = query.eq('email_normalized', normalizeEmail(input.email))
  else throw new ApiError(400, 'comprador_id ou email obrigatorio')
  const { data: buyer } = await query.maybeSingle()
  if (!buyer) throw new ApiError(404, 'Comprador nao encontrado')
  const template = 'Skip-Summit26-Send-Comprador-Email02'
  let sent = true
  let sendError = ''
  try {
    await sendBuyerAccess(
      buyer,
      'api_resend_buyer',
      Deno.env.get('SENDGRID_BUYER_REMINDER_TEMPLATE_ID') || undefined,
    )
  } catch (error) {
    sent = false
    sendError = error instanceof Error ? error.message : 'SEND_FAILED'
  }
  await auditEvent(db, {
    evento: 'api_reenvio_comprador',
    detalhe: `E-mail de acesso reenviado pela API para ${buyer.email}`,
    payload: { comprador_id: buyer.id },
  })
  return json({
    success: sent,
    comprador_id: buyer.id,
    email: buyer.email,
    template,
    erro: sendError,
  })
}

async function externalResendParticipant(req: Request) {
  await externalAuthorized(req)
  await requireOperationalWrite()
  const input = await body<Record<string, unknown>>(req)
  const db = adminDb()
  let query = db.from('participantes').select('id,ingresso_id,nome_completo,email')
  if (input.participante_id) query = query.eq('id', String(input.participante_id))
  else if (input.email) query = query.eq('email_normalized', normalizeEmail(input.email))
  else throw new ApiError(400, 'participante_id ou email obrigatorio')
  const { data: participant } = await query.maybeSingle()
  if (!participant) throw new ApiError(404, 'Participante nao encontrado')
  const template = 'Skip-Summit26-Send-Participante'
  let sent = true
  let sendError = ''
  try {
    await sendParticipantTicket(participant, 'api_resend_participant')
  } catch (error) {
    sent = false
    sendError = error instanceof Error ? error.message : 'SEND_FAILED'
  }
  await auditEvent(db, {
    ingressoId: participant.ingresso_id,
    evento: 'api_reenvio_participante',
    detalhe: `E-mail do participante reenviado pela API para ${participant.email}`,
    payload: { participante_id: participant.id },
  })
  return json({
    success: sent,
    participante_id: participant.id,
    email: participant.email,
    template,
    erro: sendError,
  })
}

async function dispatchHealth() {
  const { data, error } = await adminDb()
    .from('cron_health')
    .select('last_run,email_last_run,whatsapp_last_run,metadata')
    .eq('id', 'dispatch')
    .maybeSingle()
  if (error) throw error
  return json({
    last_run: data?.last_run ?? '',
    email_last_run: data?.email_last_run ?? '',
    whatsapp_last_run: data?.whatsapp_last_run ?? '',
    now: new Date().toISOString(),
    metadata: data?.metadata ?? {},
  })
}

export async function handlePublicParity(req: Request, path: string): Promise<Response | null> {
  if (req.method === 'GET' && path === '/backend/v1/dispatch/health') {
    return dispatchHealth()
  }
  const courtesyInfoMatch = path.match(/^\/backend\/v1\/cortesia\/info\/([^/]+)$/)
  if (req.method === 'GET' && courtesyInfoMatch) {
    return courtesyInfo(decodeURIComponent(courtesyInfoMatch[1]))
  }
  if (req.method === 'POST' && path === '/backend/v1/cortesia/registrar') {
    return registerCourtesy(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/webhooks/guru') return guruWebhook(req)
  if (req.method === 'GET' && path === '/backend/v1/external/compradores') {
    return externalBuyers(req)
  }
  if (req.method === 'GET' && path === '/backend/v1/external/participantes') {
    return externalParticipants(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/external/compradores') {
    return externalCreateBuyer(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/external/credenciamento') {
    return externalCredential(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/external/reenviar-comprador') {
    return externalResendBuyer(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/external/reenviar-participante') {
    return externalResendParticipant(req)
  }
  return null
}

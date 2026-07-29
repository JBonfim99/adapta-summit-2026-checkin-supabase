import { adminDb, requireHelpdesk, rpc } from '../_shared/db.ts'
import { ApiError, body, handler, json, routePath } from '../_shared/http.ts'
import {
  dispatchCredentialToInac,
  mutateCredentialledTicket,
} from '../_shared/ticket-operations.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import {
  auditEvent,
  cpfDigits,
  createParticipantViewToken,
  normalizeEmail,
  requireOperationalWrite,
  ticketTypes,
  validCpf,
  validPhone,
} from '../_shared/operations.ts'

interface PersonInput extends Record<string, unknown> {
  nome_completo?: string
  email?: string
  cpf?: string
  telefone?: string
  empresa?: string
  nome_empresa?: string
  operador?: string
}

const appUrl = () => (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')

function validatePerson(input: PersonInput) {
  const name = String(input.nome_completo ?? '').trim()
  const email = normalizeEmail(input.email)
  if (name.length < 3) throw new ApiError(400, 'Informe o nome completo.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError(400, 'E-mail invalido.')
  }
  if (!validCpf(input.cpf)) throw new ApiError(400, 'CPF invalido.')
  if (!validPhone(input.telefone)) {
    throw new ApiError(400, 'Telefone invalido (informe com DDD).')
  }
}

async function search(req: Request) {
  const query = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (query.length < 2) return json({ compradores: [] })
  const db = adminDb()
  const escaped = query.replaceAll(',', ' ')
  const pattern = `%${escaped}%`

  const [{ data: buyers }, { data: participants }, { data: matchedTickets }] = await Promise.all([
    db
      .from('compradores')
      .select('id,nome,email,documento,telefone')
      .or(`nome.ilike.${pattern},email.ilike.${pattern},documento.ilike.${pattern}`)
      .limit(30),
    db
      .from('participantes')
      .select('id,ingresso_id,nome_completo,email,cpf,telefone,nome_empresa')
      .or(`nome_completo.ilike.${pattern},email.ilike.${pattern},cpf.ilike.${pattern}`)
      .limit(30),
    db
      .from('ingressos')
      .select('id,comprador_id')
      .ilike('pedido_id', pattern)
      .limit(30),
  ])

  const ticketIds = new Set([
    ...(participants ?? []).map((participant) => participant.ingresso_id),
    ...(matchedTickets ?? []).map((ticket) => ticket.id),
  ])
  let relatedTickets: Array<Record<string, unknown>> = []
  if (ticketIds.size > 0) {
    const { data } = await db
      .from('ingressos')
      .select(
        'id,comprador_id,pedido_id,tipo_ingresso,status,participante_id,inac_id,inac_qr,status_webhook,origem',
      )
      .in('id', [...ticketIds])
    relatedTickets = data ?? []
  }

  const buyerIds = new Set([
    ...(buyers ?? []).map((buyer) => buyer.id),
    ...(matchedTickets ?? []).map((ticket) => ticket.comprador_id),
    ...relatedTickets.map((ticket) => String(ticket.comprador_id)),
  ])
  if (buyerIds.size === 0) return json({ compradores: [] })

  const [{ data: allBuyers }, { data: allTickets }] = await Promise.all([
    db
      .from('compradores')
      .select('id,nome,email,documento,telefone')
      .in('id', [...buyerIds]),
    db
      .from('ingressos')
      .select(
        'id,comprador_id,pedido_id,tipo_ingresso,status,participante_id,inac_id,inac_qr,status_webhook,origem',
      )
      .in('comprador_id', [...buyerIds])
      .order('created_at'),
  ])

  const participantIds = (allTickets ?? [])
    .map((ticket) => ticket.participante_id)
    .filter(Boolean)
  const { data: allParticipants } =
    participantIds.length > 0
      ? await db
          .from('participantes')
          .select('id,nome_completo,email,cpf,telefone,nome_empresa')
          .in('id', participantIds)
      : { data: [] }
  const participantById = new Map((allParticipants ?? []).map((item) => [item.id, item]))
  const directBuyerIds = new Set((buyers ?? []).map((buyer) => buyer.id))

  const response = (allBuyers ?? []).map((buyer) => {
    const buyerTickets = (allTickets ?? []).filter((ticket) => ticket.comprador_id === buyer.id)
    return {
      ...buyer,
      match_comprador: directBuyerIds.has(buyer.id),
      total_ingressos: buyerTickets.length,
      ingressos_encontrados: buyerTickets.filter((ticket) => ticketIds.has(ticket.id)).length,
      ingressos: buyerTickets.map((ticket) => {
        const participant = participantById.get(ticket.participante_id)
        return {
          id: ticket.id,
          pedido_id: ticket.pedido_id,
          tipo_ingresso: ticket.tipo_ingresso,
          status: ticket.status,
          credenciado: ticket.status === 'Pré-Credenciado',
          tem_qr: Boolean(ticket.inac_qr),
          status_webhook: ticket.status_webhook,
          origem: ticket.origem,
          match: ticketIds.has(ticket.id),
          origem_info: ticket.origem,
          participante: participant
            ? { ...participant, empresa: participant.nome_empresa }
            : null,
        }
      }),
    }
  })
  return json({ compradores: response })
}

async function credential(req: Request) {
  const input = await body<PersonInput & { ingresso_id?: string }>(req)
  validatePerson(input)
  const ticketId = String(input.ingresso_id ?? '')
  const actor = `helpdesk:${String(input.operador ?? 'unknown')}`
  const db = adminDb()
  await requireOperationalWrite(db)
  const result = await rpc<{ ticketId: string; participantId: string }>('credential_ticket', {
    p_ticket_id: ticketId,
    p_payload: input,
    p_actor: actor,
  })
  const inac = await dispatchCredentialToInac(db, result.ticketId, result.participantId)
  await auditEvent(db, {
    ingressoId: result.ticketId,
    evento: 'helpdesk_credenciamento',
    detalhe: `Credenciamento realizado no helpdesk por ${String(input.operador ?? 'nao identificado')}`,
    status: inac.success ? 200 : inac.status,
    payload: {
      operador: input.operador,
      participante_id: result.participantId,
    },
    response: inac.success ? 'INAC /add OK' : inac.error,
  })
  return json({
    ok: true,
    success: true,
    qrcode: inac.qrCode ?? '',
    inac_ok: inac.success,
    inac_msg: inac.error,
    avisos: inac.success ? [] : [`A INAC nao confirmou a credencial: ${inac.error}`],
    log_ok: true,
  })
}

async function newCredential(req: Request) {
  const input = await body<PersonInput & { tipo?: string; motivo?: string }>(req)
  const db = adminDb()
  await requireOperationalWrite(db)
  validatePerson(input)
  const motivo = String(input.motivo ?? '').replace(/\s+/g, ' ').trim()
  if (motivo.length < 5) {
    throw new ApiError(400, 'Escreva o motivo deste novo credenciamento.')
  }
  const type = String(input.tipo ?? '').toUpperCase()
  if (!ticketTypes.includes(type as (typeof ticketTypes)[number])) {
    throw new ApiError(400, 'Escolha o tipo do ingresso.')
  }
  const email = normalizeEmail(input.email)
  let { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('email_normalized', email)
    .maybeSingle()
  let buyerCreated = false
  if (!buyer) {
    const inserted = await db
      .from('compradores')
      .insert({
        nome: String(input.nome_completo ?? ''),
        email,
        telefone: String(input.telefone ?? ''),
        documento: cpfDigits(input.cpf),
      })
      .select('id,nome,email')
      .single()
    if (inserted.error) throw inserted.error
    buyer = inserted.data
    buyerCreated = true
  }

  let orderId = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `H${Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0')}`
    const { count } = await db
      .from('ingressos')
      .select('*', { count: 'exact', head: true })
      .eq('pedido_id', candidate)
    if ((count ?? 0) === 0) {
      orderId = candidate
      break
    }
  }
  if (!orderId) throw new ApiError(500, 'Nao foi possivel gerar um numero de pedido.')

  const { data: ticket, error } = await db
    .from('ingressos')
    .insert({
      comprador_id: buyer.id,
      pedido_id: orderId,
      tipo_ingresso: type,
      origem: 'helpdesk',
    })
    .select('id')
    .single()
  if (error) throw error

  const response = await credential(
    new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({ ...input, ingresso_id: ticket.id }),
    }),
  )
  const payload = await response.json()
  await auditEvent(db, {
    ingressoId: ticket.id,
    evento: 'helpdesk_novo_credenciamento',
    detalhe:
      `Novo credenciamento criado por ${String(input.operador ?? 'nao identificado')} ` +
      `- pedido ${orderId} - ${type} - motivo: ${motivo}`,
    payload: {
      operador: input.operador,
      pedido_id: orderId,
      tipo: type,
      motivo,
      comprador_criado: buyerCreated,
      email,
    },
    response: payload.inac_ok ? 'INAC /add OK' : `INAC: ${payload.inac_msg ?? ''}`,
  })
  return json({
    ...payload,
    pedido_id: orderId,
    tipo_ingresso: type,
    comprador_criado: buyerCreated,
    log_ok: true,
  })
}

async function qr(ticketId: string, generate: boolean, operator: string) {
  const db = adminDb()
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,participante_id,inac_qr')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket?.participante_id) throw new ApiError(404, 'TICKET_NOT_CREDENTIALLED')
  if (generate && !ticket.inac_qr) {
    await requireOperationalWrite(db)
    const inac = await dispatchCredentialToInac(db, ticket.id, ticket.participante_id)
    if (!inac.success) throw new ApiError(502, 'INAC_OPERATION_FAILED', inac)
    await auditEvent(db, {
      ingressoId: ticket.id,
      evento: 'helpdesk_qr_gerado',
      detalhe: `QR gerado no helpdesk por ${operator}`,
      payload: { operador: operator },
    })
    return json({ success: true, qrcode: inac.qrCode, log_ok: true })
  }
  await auditEvent(db, {
    ingressoId: ticket.id,
    evento: 'helpdesk_qr',
    detalhe: `QR consultado no helpdesk por ${operator}`,
    payload: { operador: operator },
  })
  return json({ success: true, qrcode: ticket.inac_qr, log_ok: true })
}

async function resendBuyer(buyerId: string, operator: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('id', buyerId)
    .maybeSingle()
  if (!buyer) throw new ApiError(404, 'BUYER_NOT_FOUND')

  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  await db.from('tokens_acesso').insert({
    comprador_id: buyer.id,
    token,
    expira_em: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  })
  const accessUrl = `${appUrl()}/acesso?token=${token}`
  await sendEmail(db, {
    to: buyer.email,
    templateId: Deno.env.get('SENDGRID_BUYER_TEMPLATE_ID') || undefined,
    subject: 'Seu acesso ao Adapta Summit 2026',
    html: `<p><a href="${accessUrl}">Acesse seus ingressos</a>.</p>`,
    dynamicData: { nome: buyer.nome, access_url: accessUrl },
    idempotencyKey: `helpdesk-buyer:${buyer.id}:${token}`,
    operation: 'helpdesk_resend_buyer',
  })
  await auditEvent(db, {
    evento: 'helpdesk_reenvio_comprador',
    detalhe: `E-mail do comprador reenviado no helpdesk por ${operator}`,
    payload: { operador: operator, comprador_id: buyer.id, email: buyer.email },
  })
  return json({ success: true, log_ok: true, avisos: [] })
}

async function resendParticipant(ticketId: string, operator: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,participante_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket?.participante_id) throw new ApiError(404, 'TICKET_NOT_CREDENTIALLED')
  const { data: participant } = await db
    .from('participantes')
    .select('id,nome_completo,email')
    .eq('id', ticket.participante_id)
    .single()
  const link = await createParticipantViewToken(db, ticket.id)
  const ticketUrl = `${appUrl()}/ingresso?token=${link.token}`
  await sendEmail(db, {
    to: participant.email,
    templateId: Deno.env.get('SENDGRID_PARTICIPANT_TEMPLATE_ID') || undefined,
    subject: 'Seu ingresso do Adapta Summit 2026',
    html: `<p><a href="${ticketUrl}">Visualize seu ingresso</a>.</p>`,
    dynamicData: { nome: participant.nome_completo, ticket_url: ticketUrl },
    idempotencyKey: `helpdesk-participant:${participant.id}:${Date.now()}`,
    operation: 'helpdesk_resend_participant',
  })
  await auditEvent(db, {
    ingressoId: ticket.id,
    evento: 'helpdesk_reenvio_participante',
    detalhe: `E-mail do participante reenviado no helpdesk por ${operator}`,
    payload: { operador: operator, participante_id: participant.id, email: participant.email },
  })
  return json({ success: true, log_ok: true, avisos: [] })
}

Deno.serve((req) =>
  handler(req, async () => {
    requireHelpdesk(req)
    const path = routePath(req, 'helpdesk-api')
    if (req.method === 'POST' && path === '/backend/v1/helpdesk/login') {
      return json({ success: true })
    }
    if (req.method === 'GET' && path === '/backend/v1/helpdesk/search') return search(req)
    if (req.method === 'POST' && path === '/backend/v1/helpdesk/credenciar') {
      return credential(req)
    }
    if (req.method === 'POST' && path === '/backend/v1/helpdesk/novo-credenciamento') {
      return newCredential(req)
    }

    const edit = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/editar$/)
    if (req.method === 'POST' && edit) {
      const input = await body<PersonInput>(req)
      validatePerson(input)
      const db = adminDb()
      await requireOperationalWrite(db)
      const result = await mutateCredentialledTicket(db, {
          ticketId: decodeURIComponent(edit[1]),
          operation: 'edit',
          actor: `helpdesk:${String(input.operador ?? 'unknown')}`,
          payload: input,
        })
      await auditEvent(db, {
        ingressoId: decodeURIComponent(edit[1]),
        evento: 'helpdesk_edicao',
        detalhe: `Dados editados no helpdesk por ${String(input.operador ?? 'nao identificado')}`,
        payload: { operador: input.operador },
      })
      return json({ ...result, log_ok: true, avisos: [] })
    }
    const type = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/tipo$/)
    if (req.method === 'POST' && type) {
      const input = await body<Record<string, unknown>>(req)
      const motivo = String(input.motivo ?? '').replace(/\s+/g, ' ').trim()
      if (motivo.length < 5) throw new ApiError(400, 'Informe o motivo da troca.')
      const nextType = String(input.tipo ?? '').toUpperCase()
      if (!ticketTypes.includes(nextType as (typeof ticketTypes)[number])) {
        throw new ApiError(400, 'Escolha o tipo do ingresso.')
      }
      const db = adminDb()
      await requireOperationalWrite(db)
      const result = await mutateCredentialledTicket(db, {
          ticketId: decodeURIComponent(type[1]),
          operation: 'change_type',
          actor: `helpdesk:${String(input.operador ?? 'unknown')}`,
          payload: input,
        })
      await auditEvent(db, {
        ingressoId: decodeURIComponent(type[1]),
        evento: 'helpdesk_tipo_alterado',
        detalhe:
          `Tipo alterado para ${nextType} no helpdesk por ` +
          `${String(input.operador ?? 'nao identificado')} - motivo: ${motivo}`,
        payload: { operador: input.operador, tipo: nextType, motivo },
      })
      return json({ ...result, log_ok: true, avisos: [] })
    }
    const qrView = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/qr$/)
    if (req.method === 'GET' && qrView) {
      const operator =
        new URL(req.url).searchParams.get('operador')?.trim() || 'nao identificado'
      return qr(decodeURIComponent(qrView[1]), false, operator)
    }
    const qrGenerate = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/gerar-qr$/)
    if (req.method === 'POST' && qrGenerate) {
      const input = await body<{ operador?: string }>(req)
      return qr(
        decodeURIComponent(qrGenerate[1]),
        true,
        String(input.operador ?? 'nao identificado'),
      )
    }
    const resendBuyerMatch = path.match(
      /^\/backend\/v1\/helpdesk\/comprador\/([^/]+)\/reenviar$/,
    )
    if (req.method === 'POST' && resendBuyerMatch) {
      const input = await body<{ operador?: string }>(req)
      return resendBuyer(
        decodeURIComponent(resendBuyerMatch[1]),
        String(input.operador ?? 'nao identificado'),
      )
    }
    const resendParticipantMatch = path.match(
      /^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/reenviar$/,
    )
    if (req.method === 'POST' && resendParticipantMatch) {
      const input = await body<{ operador?: string }>(req)
      return resendParticipant(
        decodeURIComponent(resendParticipantMatch[1]),
        String(input.operador ?? 'nao identificado'),
      )
    }
    throw new ApiError(404, 'ROUTE_NOT_FOUND')
  }),
)

import { adminDb, requireHelpdesk, rpc } from '../_shared/db.ts'
import { ApiError, body, handler, json, routePath } from '../_shared/http.ts'
import {
  dispatchCredentialToInac,
  mutateCredentialledTicket,
} from '../_shared/ticket-operations.ts'
import { sendEmail } from '../_shared/sendgrid.ts'

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
  const ticketId = String(input.ingresso_id ?? '')
  const actor = `helpdesk:${String(input.operador ?? 'unknown')}`
  const result = await rpc<{ ticketId: string; participantId: string }>('credential_ticket', {
    p_ticket_id: ticketId,
    p_payload: input,
    p_actor: actor,
  })
  const inac = await dispatchCredentialToInac(adminDb(), result.ticketId, result.participantId)
  return json({
    success: true,
    qrcode: inac.qrCode ?? '',
    inac_ok: inac.success,
    inac_msg: inac.error,
  })
}

async function newCredential(req: Request) {
  const input = await body<PersonInput & { tipo?: string; motivo?: string }>(req)
  const db = adminDb()
  const email = String(input.email ?? '').trim().toLowerCase()
  let { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('email_normalized', email)
    .maybeSingle()
  if (!buyer) {
    const inserted = await db
      .from('compradores')
      .insert({
        nome: String(input.nome_completo ?? ''),
        email,
        telefone: String(input.telefone ?? ''),
        documento: String(input.cpf ?? ''),
      })
      .select('id,nome,email')
      .single()
    if (inserted.error) throw inserted.error
    buyer = inserted.data
  }

  const { data: ticket, error } = await db
    .from('ingressos')
    .insert({
      comprador_id: buyer.id,
      pedido_id: `HELPDESK-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      tipo_ingresso: String(input.tipo ?? 'GOLD'),
      origem: `helpdesk:${String(input.operador ?? 'unknown')}`,
    })
    .select('id')
    .single()
  if (error) throw error

  return credential(
    new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({ ...input, ingresso_id: ticket.id }),
    }),
  )
}

async function qr(ticketId: string, generate: boolean) {
  const db = adminDb()
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,participante_id,inac_qr')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket?.participante_id) throw new ApiError(404, 'TICKET_NOT_CREDENTIALLED')
  if (generate && !ticket.inac_qr) {
    const inac = await dispatchCredentialToInac(db, ticket.id, ticket.participante_id)
    if (!inac.success) throw new ApiError(502, 'INAC_OPERATION_FAILED', inac)
    return json({ success: true, qrcode: inac.qrCode })
  }
  return json({ success: true, qrcode: ticket.inac_qr })
}

async function resendBuyer(buyerId: string) {
  const db = adminDb()
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
  return json({ success: true })
}

async function resendParticipant(ticketId: string) {
  const db = adminDb()
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,participante_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket?.participante_id) throw new ApiError(404, 'TICKET_NOT_CREDENTIALLED')
  const [{ data: participant }, { data: link }] = await Promise.all([
    db
      .from('participantes')
      .select('id,nome_completo,email')
      .eq('id', ticket.participante_id)
      .single(),
    db
      .from('links_participante')
      .select('token')
      .eq('ingresso_id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!link) throw new ApiError(404, 'PARTICIPANT_LINK_NOT_FOUND')
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
  return json({ success: true })
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
      return json(
        await mutateCredentialledTicket(adminDb(), {
          ticketId: decodeURIComponent(edit[1]),
          operation: 'edit',
          actor: `helpdesk:${String(input.operador ?? 'unknown')}`,
          payload: input,
        }),
      )
    }
    const type = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/tipo$/)
    if (req.method === 'POST' && type) {
      const input = await body<Record<string, unknown>>(req)
      return json(
        await mutateCredentialledTicket(adminDb(), {
          ticketId: decodeURIComponent(type[1]),
          operation: 'change_type',
          actor: `helpdesk:${String(input.operador ?? 'unknown')}`,
          payload: input,
        }),
      )
    }
    const qrView = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/qr$/)
    if (req.method === 'GET' && qrView) return qr(decodeURIComponent(qrView[1]), false)
    const qrGenerate = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/gerar-qr$/)
    if (req.method === 'POST' && qrGenerate) {
      return qr(decodeURIComponent(qrGenerate[1]), true)
    }
    const resendBuyerMatch = path.match(
      /^\/backend\/v1\/helpdesk\/comprador\/([^/]+)\/reenviar$/,
    )
    if (req.method === 'POST' && resendBuyerMatch) {
      return resendBuyer(decodeURIComponent(resendBuyerMatch[1]))
    }
    const resendParticipantMatch = path.match(
      /^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/reenviar$/,
    )
    if (req.method === 'POST' && resendParticipantMatch) {
      return resendParticipant(decodeURIComponent(resendParticipantMatch[1]))
    }
    throw new ApiError(404, 'ROUTE_NOT_FOUND')
  }),
)

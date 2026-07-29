import { adminDb, rpc } from '../_shared/db.ts'
import { ApiError, body, handler, json, routePath } from '../_shared/http.ts'
import { callInac } from '../_shared/inac.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import {
  createParticipantViewToken,
  requireOperationalWrite,
} from '../_shared/operations.ts'
import { handlePublicParity } from '../_shared/public-parity.ts'

interface ParticipantPayload extends Record<string, unknown> {
  token?: string
  email?: string
  cpf?: string
  terms_accepted?: boolean
}

const appUrl = () => (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')

async function magicLink(req: Request) {
  await requireOperationalWrite()
  const input = await body<{ email?: string }>(req)
  const email = String(input.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) throw new ApiError(400, 'EMAIL_INVALIDO')

  const db = adminDb()
  const { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('email_normalized', email)
    .maybeSingle()

  if (!buyer) {
    const { data: participant } = await db
      .from('participantes')
      .select('id,ingresso_id,nome_completo,email')
      .eq('email_normalized', email)
      .maybeSingle()
    // Do not disclose which addresses are registered.
    if (!participant) return json({ success: true })

    const { token: ticketToken } = await createParticipantViewToken(
      db,
      participant.ingresso_id,
    )
    const ticketUrl = `${appUrl()}/ingresso?token=${encodeURIComponent(ticketToken)}`
    await sendEmail(db, {
      to: participant.email,
      templateId: Deno.env.get('SENDGRID_PARTICIPANT_TEMPLATE_ID') || undefined,
      subject: 'Seu ingresso do Adapta Summit 2026',
      html: `<p><a href="${ticketUrl}">Visualize seu ingresso</a>.</p>`,
      dynamicData: {
        nome: participant.nome_completo,
        firstname: participant.nome_completo.split(' ')[0] || participant.nome_completo,
        token: ticketToken,
        ticket_url: ticketUrl,
      },
      idempotencyKey: `participant-access:${participant.id}:${ticketToken}`,
      operation: 'participant_magic_link',
    })
    return json({ success: true, sent: true })
  }

  const { data: existing } = await db
    .from('tokens_acesso')
    .select('token,expira_em')
    .eq('comprador_id', buyer.id)
    .eq('usado', false)
    .gt('expira_em', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let token = existing?.token
  if (!token) {
    token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await db.from('tokens_acesso').insert({
      comprador_id: buyer.id,
      token,
      expira_em: expiresAt,
    })
    if (error) throw error
  }

  const accessUrl = `${appUrl()}/acesso?token=${encodeURIComponent(token)}`
  await sendEmail(db, {
    to: buyer.email,
    templateId: Deno.env.get('SENDGRID_BUYER_TEMPLATE_ID') || undefined,
    subject: 'Seu acesso ao Adapta Summit 2026',
    html: `<p>Ola, ${buyer.nome}.</p><p><a href="${accessUrl}">Acesse seus ingressos</a>.</p>`,
    dynamicData: { nome: buyer.nome, access_url: accessUrl },
    idempotencyKey: `buyer-access:${buyer.id}:${token}`,
    operation: 'buyer_magic_link',
  })

  return json({ success: true, sent: true })
}

async function consumeMagicLink(req: Request) {
  const input = await body<{ token?: string }>(req)
  const token = String(input.token ?? '')
  const buyer = await rpc<Record<string, unknown>>('consume_buyer_token', { p_token: token })
  return json({ token, comprador: buyer })
}

async function participantLink(token: string) {
  const db = adminDb()
  const { data: link, error } = await db
    .from('links_participante')
    .select('id,ingresso_id,usado,expira_em')
    .eq('token', token)
    .maybeSingle()

  if (error || !link || new Date(link.expira_em).getTime() <= Date.now()) {
    throw new ApiError(404, 'INVALID_OR_EXPIRED_LINK')
  }

  const { data: ticket } = await db
    .from('ingressos')
    .select('id,pedido_id,tipo_ingresso,status,comprador_id')
    .eq('id', link.ingresso_id)
    .single()
  const { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('id', ticket.comprador_id)
    .single()

  return json({
    ...ticket,
    usado: link.usado,
    used: link.usado,
    expiresAt: link.expira_em,
    comprador: buyer,
  })
}

async function participantTicket(token: string) {
  const db = adminDb()
  const { data: link } = await db
    .from('links_participante')
    .select('ingresso_id,expira_em')
    .eq('token', token)
    .maybeSingle()
  if (!link || new Date(link.expira_em).getTime() <= Date.now()) {
    throw new ApiError(404, 'TICKET_NOT_FOUND')
  }

  const { data: ticket } = await db
    .from('ingressos')
    .select(
      'id,pedido_id,tipo_ingresso,status,participante_id,inac_id,inac_qr,preenchido_em',
    )
    .eq('id', link.ingresso_id)
    .single()
  if (!ticket?.participante_id) throw new ApiError(404, 'TICKET_NOT_CREDENTIALLED')

  const { data: participant } = await db
    .from('participantes')
    .select('nome_completo,email,cpf,telefone,tem_empresa,nome_empresa,cargo,profissao,nicho')
    .eq('id', ticket.participante_id)
    .single()

  return json({
    id: ticket.id,
    pedido_id: ticket.pedido_id,
    tipo_ingresso: ticket.tipo_ingresso,
    status: ticket.status,
    preenchido: Boolean(ticket.participante_id),
    inac_id: ticket.inac_id,
    inac_qr: ticket.inac_qr,
    preenchido_em: ticket.preenchido_em,
    participante: participant,
  })
}

async function availability(req: Request, field: 'email' | 'cpf') {
  const input = await body<ParticipantPayload>(req)
  const db = adminDb()
  const value =
    field === 'email'
      ? String(input.email ?? '').trim().toLowerCase()
      : String(input.cpf ?? '').replace(/\D/g, '')
  const column = field === 'email' ? 'email_normalized' : 'cpf_normalized'
  const { count, error } = await db
    .from('participantes')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
  if (error) throw error
  return json({ available: (count ?? 0) === 0 })
}

async function submitParticipant(req: Request) {
  await requireOperationalWrite()
  const input = await body<ParticipantPayload>(req)
  const token = String(input.token ?? '')
  const payload = {
    ...input,
    termsAccepted: Boolean(input.terms_accepted ?? input.termsAccepted),
  }

  const result = await rpc<{
    ticketId: string
    participantId: string
  }>('submit_participant', {
    p_link_token: token,
    p_payload: payload,
  })

  const db = adminDb()
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,pedido_id,tipo_ingresso,inac_id')
    .eq('id', result.ticketId)
    .single()
  const { data: participant } = await db
    .from('participantes')
    .select('id,nome_completo,email,cpf,telefone,nome_empresa,profissao')
    .eq('id', result.participantId)
    .single()

  const inac = await callInac(db, 'add', ticket, participant)
  await db
    .from('ingressos')
    .update(
      inac.success
        ? {
            inac_id: inac.inacId,
            inac_qr: inac.qrCode,
            status_webhook: 'enviado',
          }
        : { status_webhook: 'erro' },
    )
    .eq('id', ticket.id)

  await db.from('webhooks_log').insert({
    ingresso_id: ticket.id,
    status: inac.status,
    method: 'POST',
    evento: inac.success ? 'webhook_enviado' : 'webhook_erro',
    detalhe: inac.success ? 'INAC /add completed' : inac.error,
    payload: JSON.stringify(inac.payload),
    response: JSON.stringify(inac.response).slice(0, 500),
    metadata: { mock: inac.mock },
  })

  return json({
    success: true,
    qrcode: inac.qrCode ?? '',
    inac_ok: inac.success,
    inac_error: inac.error,
  })
}

async function clientError(req: Request) {
  const input = await body<Record<string, unknown>>(req)
  await adminDb().from('webhooks_log').insert({
    status: 0,
    method: 'CLIENT',
    evento: 'client_error',
    detalhe: String(input.message ?? 'Client error').slice(0, 1000),
    metadata: input,
  })
  return json({ success: true })
}

Deno.serve((req) =>
  handler(req, async () => {
    const path = routePath(req, 'public-api')

    if (req.method === 'POST' && path === '/backend/v1/auth/magic-link') {
      return magicLink(req)
    }
    if (req.method === 'POST' && path === '/backend/v1/auth/magic-link/consume') {
      return consumeMagicLink(req)
    }
    if (req.method === 'POST' && path === '/backend/v1/participant/email-check') {
      return availability(req, 'email')
    }
    if (req.method === 'POST' && path === '/backend/v1/participant/cpf-check') {
      return availability(req, 'cpf')
    }
    if (req.method === 'POST' && path === '/backend/v1/participant/submit') {
      return submitParticipant(req)
    }
    if (req.method === 'POST' && path === '/backend/v1/client-error') {
      return clientError(req)
    }

    const linkMatch = path.match(/^\/backend\/v1\/participant\/link\/([^/]+)$/)
    if (req.method === 'GET' && linkMatch) {
      return participantLink(decodeURIComponent(linkMatch[1]))
    }
    const ticketMatch = path.match(/^\/backend\/v1\/participant\/ticket\/([^/]+)$/)
    if (req.method === 'GET' && ticketMatch) {
      return participantTicket(decodeURIComponent(ticketMatch[1]))
    }

    const parityResponse = await handlePublicParity(req, path)
    if (parityResponse) return parityResponse

    throw new ApiError(404, 'ROUTE_NOT_FOUND')
  }),
)

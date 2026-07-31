import { adminDb, rpc } from '../_shared/db.ts'
import { ApiError, body, handler, json, routePath } from '../_shared/http.ts'
import {
  dispatchCredentialToInac,
  mutateCredentialledTicket,
} from '../_shared/ticket-operations.ts'
import { sendEmail, sendGridTemplateId, sendGridTemplateNames } from '../_shared/sendgrid.ts'
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
  profissao?: string
  operador?: string
}

interface CredentialResult {
  ticketId: string
  participantId: string
  pedidoId: string
  tipoIngresso: string
  buyerCreated?: boolean
}

const appUrl = () => (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')

function validatePerson(input: PersonInput) {
  const name = String(input.nome_completo ?? '').trim()
  const email = normalizeEmail(input.email)
  if (name.length < 3) throw new ApiError(400, 'Informe o nome completo.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError(400, 'E-mail inválido.')
  }
  if (!validCpf(input.cpf)) throw new ApiError(400, 'CPF inválido.')
  if (!validPhone(input.telefone)) {
    throw new ApiError(400, 'Telefone inválido (informe com DDD).')
  }
}

function operator(input: { operador?: unknown }) {
  return (
    String(input.operador ?? '')
      .replace(/\s+/g, ' ')
      .trim() || 'não identificado'
  )
}

async function search(req: Request) {
  const query = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (query.length < 3) {
    return json({ ok: true, compradores: [], aviso: 'Digite pelo menos 3 caracteres.' })
  }
  return json(await rpc('helpdesk_search', { p_query: query }))
}

async function credential(req: Request) {
  const input = await body<PersonInput & { ingresso_id?: string }>(req)
  validatePerson(input)
  const ticketId = String(input.ingresso_id ?? '')
  if (!ticketId) throw new ApiError(400, 'Ingresso não informado.')
  const attendant = operator(input)
  const db = adminDb()
  await requireOperationalWrite(db)
  const result = await rpc<CredentialResult>('credential_ticket', {
    p_ticket_id: ticketId,
    p_payload: {
      ...input,
      email: normalizeEmail(input.email),
      cpf: cpfDigits(input.cpf),
      termsAccepted: true,
    },
    p_actor: `helpdesk:${attendant}`,
  })
  const inac = await dispatchCredentialToInac(db, result.ticketId, result.participantId)
  await auditEvent(db, {
    ingressoId: result.ticketId,
    evento: 'helpdesk_credenciamento',
    method: 'HELPDESK',
    detalhe: `Credenciamento realizado no helpdesk por ${attendant}`,
    status: inac.success ? 200 : inac.status,
    payload: {
      operador: attendant,
      participante_id: result.participantId,
      pedido_id: result.pedidoId,
    },
    response: inac.success ? 'INAC /add OK' : inac.error,
  })
  return json({
    ok: true,
    success: true,
    qrcode: inac.qrCode ?? '',
    pedido_id: result.pedidoId,
    tipo_ingresso: result.tipoIngresso,
    nome: String(input.nome_completo ?? '').trim(),
    inac_ok: inac.success,
    inac_msg: inac.error,
    avisos: inac.success ? [] : [`A INAC não confirmou a credencial: ${inac.error}`],
    log_ok: true,
  })
}

async function newCredential(req: Request) {
  const input = await body<PersonInput & { tipo?: string; motivo?: string }>(req)
  validatePerson(input)
  const reason = String(input.motivo ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (reason.length < 5) {
    throw new ApiError(400, 'Escreva o motivo deste novo credenciamento.')
  }
  const type = String(input.tipo ?? '').toUpperCase()
  if (!ticketTypes.includes(type as (typeof ticketTypes)[number])) {
    throw new ApiError(400, 'Escolha o tipo do ingresso.')
  }
  const attendant = operator(input)
  const db = adminDb()
  await requireOperationalWrite(db)
  const result = await rpc<CredentialResult>('create_helpdesk_credential', {
    p_payload: {
      ...input,
      email: normalizeEmail(input.email),
      cpf: cpfDigits(input.cpf),
    },
    p_ticket_type: type,
    p_operator: attendant,
    p_reason: reason,
  })
  const inac = await dispatchCredentialToInac(db, result.ticketId, result.participantId)
  await auditEvent(db, {
    ingressoId: result.ticketId,
    evento: 'helpdesk_novo_credenciamento',
    method: 'HELPDESK',
    detalhe:
      `Novo credenciamento criado por ${attendant} - pedido ${result.pedidoId} - ` +
      `${result.tipoIngresso} - motivo: ${reason}`,
    status: inac.success ? 200 : inac.status,
    payload: {
      operador: attendant,
      pedido_id: result.pedidoId,
      tipo: result.tipoIngresso,
      motivo: reason,
      comprador_criado: result.buyerCreated,
      email: normalizeEmail(input.email),
    },
    response: inac.success ? 'INAC /add OK' : `INAC: ${inac.error ?? ''}`,
  })
  return json({
    ok: true,
    success: true,
    qrcode: inac.qrCode ?? '',
    pedido_id: result.pedidoId,
    tipo_ingresso: result.tipoIngresso,
    nome: String(input.nome_completo ?? '').trim(),
    comprador_criado: result.buyerCreated,
    inac_ok: inac.success,
    inac_msg: inac.error,
    avisos: inac.success ? [] : [`A INAC não confirmou a credencial: ${inac.error}`],
    log_ok: true,
  })
}

async function qr(ticketId: string, generate: boolean, attendant: string) {
  const db = adminDb()
  const { data: ticket, error } = await db
    .from('ingressos')
    .select('id,pedido_id,tipo_ingresso,participante_id,inac_qr')
    .eq('id', ticketId)
    .maybeSingle()
  if (error) throw error
  if (!ticket) throw new ApiError(404, 'Ingresso não encontrado.')

  let participantName = ''
  if (ticket.participante_id) {
    const { data: participant } = await db
      .from('participantes')
      .select('nome_completo')
      .eq('id', ticket.participante_id)
      .maybeSingle()
    participantName = participant?.nome_completo ?? ''
  }

  let qrcode = ticket.inac_qr ?? ''
  const warnings: string[] = []
  if (generate && !qrcode) {
    if (!ticket.participante_id) {
      throw new ApiError(400, 'Participante não encontrado para este ingresso.')
    }
    await requireOperationalWrite(db)
    const inac = await dispatchCredentialToInac(db, ticket.id, ticket.participante_id)
    if (!inac.success) {
      throw new ApiError(
        502,
        `Não foi possível gerar a credencial na INAC (${inac.error}). Nada mudou.`,
        inac,
      )
    }
    qrcode = inac.qrCode ?? ''
  }

  let logOk = true
  if (qrcode) {
    try {
      await auditEvent(db, {
        ingressoId: ticket.id,
        evento: generate ? 'helpdesk_qr_gerado' : 'helpdesk_qr',
        method: 'HELPDESK',
        detalhe:
          `Help desk (${attendant}) - QR Code ${generate ? 'gerado' : 'consultado'} - ` +
          `ingresso ${ticket.pedido_id}${participantName ? ` - ${participantName}` : ''}`,
        payload: {
          origem: 'helpdesk',
          acao: generate ? 'qr_gerado' : 'qr_consultado',
          operador: attendant,
          pedido_id: ticket.pedido_id,
        },
        response: 'QR entregue no balcão.',
      })
    } catch (auditError) {
      logOk = false
      warnings.push(
        `O QR Code apareceu, mas a consulta não foi registrada no histórico: ${
          auditError instanceof Error ? auditError.message : 'erro desconhecido'
        }. Avise o suporte.`,
      )
    }
  }

  return json({
    ok: true,
    qrcode,
    pedido_id: ticket.pedido_id,
    tipo_ingresso: ticket.tipo_ingresso,
    nome: participantName,
    tem_participante: Boolean(ticket.participante_id),
    avisos: warnings,
    log_ok: logOk,
  })
}

async function resendBuyer(buyerId: string, attendant: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: buyer } = await db
    .from('compradores')
    .select('id,nome,email')
    .eq('id', buyerId)
    .maybeSingle()
  if (!buyer) throw new ApiError(404, 'Comprador não encontrado.')

  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  await db.from('tokens_acesso').insert({
    comprador_id: buyer.id,
    token,
    expira_em: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  })
  const accessUrl = `${appUrl()}/acesso?token=${encodeURIComponent(token)}`
  await sendEmail(db, {
    to: buyer.email,
    templateId: sendGridTemplateId(sendGridTemplateNames.buyerFollowup) || undefined,
    subject: 'Seu acesso ao Adapta Summit 2026',
    html: `<p><a href="${accessUrl}">Acesse seus ingressos</a>.</p>`,
    dynamicData: {
      nome: buyer.nome,
      firstname: buyer.nome.split(/\s+/)[0] || buyer.nome,
      token,
      access_url: accessUrl,
    },
    idempotencyKey: `helpdesk-buyer:${buyer.id}:${token}`,
    operation: 'helpdesk_resend_buyer',
  })
  await auditEvent(db, {
    evento: 'helpdesk_reenvio_comprador',
    method: 'HELPDESK',
    detalhe: `E-mail do comprador reenviado no helpdesk por ${attendant}`,
    payload: { operador: attendant, comprador_id: buyer.id, email: buyer.email },
  })
  return json({ ok: true, success: true, log_ok: true, avisos: [] })
}

async function resendParticipant(ticketId: string, attendant: string) {
  const db = adminDb()
  await requireOperationalWrite(db)
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,participante_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket?.participante_id) throw new ApiError(404, 'Participante não encontrado.')
  const { data: participant } = await db
    .from('participantes')
    .select('id,nome_completo,email')
    .eq('id', ticket.participante_id)
    .single()
  const link = await createParticipantViewToken(db, ticket.id)
  const ticketUrl = `${appUrl()}/ingresso?token=${encodeURIComponent(link.token)}`
  await sendEmail(db, {
    to: participant.email,
    templateId: sendGridTemplateId(sendGridTemplateNames.participant) || undefined,
    subject: 'Seu ingresso do Adapta Summit 2026',
    html: `<p><a href="${ticketUrl}">Visualize seu ingresso</a>.</p>`,
    dynamicData: {
      nome: participant.nome_completo,
      firstname: participant.nome_completo.split(/\s+/)[0] || participant.nome_completo,
      token: link.token,
      ticket_url: ticketUrl,
      access_url: ticketUrl,
    },
    idempotencyKey: `helpdesk-participant:${participant.id}:${link.token}`,
    operation: 'helpdesk_resend_participant',
  })
  await auditEvent(db, {
    ingressoId: ticket.id,
    evento: 'helpdesk_reenvio_participante',
    method: 'HELPDESK',
    detalhe: `E-mail do participante reenviado no helpdesk por ${attendant}`,
    payload: { operador: attendant, participante_id: participant.id, email: participant.email },
  })
  return json({ ok: true, success: true, log_ok: true, avisos: [] })
}

Deno.serve((req) =>
  handler(req, async () => {
    const path = routePath(req, 'helpdesk-api')
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
      const attendant = operator(input)
      const db = adminDb()
      await requireOperationalWrite(db)
      const result = await mutateCredentialledTicket(db, {
        ticketId: decodeURIComponent(edit[1]),
        operation: 'edit',
        actor: `helpdesk:${attendant}`,
        payload: {
          ...input,
          email: normalizeEmail(input.email),
          cpf: cpfDigits(input.cpf),
        },
      })
      return json({ ok: true, ...result, log_ok: true, avisos: [] })
    }

    const type = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/tipo$/)
    if (req.method === 'POST' && type) {
      const input = await body<Record<string, unknown>>(req)
      const reason = String(input.motivo ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      if (reason.length < 5) {
        throw new ApiError(
          400,
          'Escreva o motivo da troca de tipo (pelo menos 5 letras). A troca não foi feita.',
        )
      }
      const nextType = String(input.tipo ?? '').toUpperCase()
      if (!ticketTypes.includes(nextType as (typeof ticketTypes)[number])) {
        throw new ApiError(400, 'Tipo deve ser GOLD, PLATINUM, PALESTRANTES ou HACKATHON.')
      }
      const attendant = operator(input)
      const db = adminDb()
      await requireOperationalWrite(db)
      const result = await mutateCredentialledTicket(db, {
        ticketId: decodeURIComponent(type[1]),
        operation: 'change_type',
        actor: `helpdesk:${attendant}`,
        payload: { ...input, tipo: nextType },
      })
      return json({
        ok: true,
        ...result,
        tipo: nextType,
        log_ok: true,
        avisos: [],
      })
    }

    const qrView = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/qr$/)
    if (req.method === 'GET' && qrView) {
      const attendant = new URL(req.url).searchParams.get('operador')?.trim() || 'não identificado'
      return qr(decodeURIComponent(qrView[1]), false, attendant)
    }
    const qrGenerate = path.match(/^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/gerar-qr$/)
    if (req.method === 'POST' && qrGenerate) {
      const input = await body<{ operador?: string }>(req)
      return qr(decodeURIComponent(qrGenerate[1]), true, operator(input))
    }
    const resendBuyerMatch = path.match(/^\/backend\/v1\/helpdesk\/comprador\/([^/]+)\/reenviar$/)
    if (req.method === 'POST' && resendBuyerMatch) {
      const input = await body<{ operador?: string }>(req)
      return resendBuyer(decodeURIComponent(resendBuyerMatch[1]), operator(input))
    }
    const resendParticipantMatch = path.match(
      /^\/backend\/v1\/helpdesk\/ticket\/([^/]+)\/reenviar$/,
    )
    if (req.method === 'POST' && resendParticipantMatch) {
      const input = await body<{ operador?: string }>(req)
      return resendParticipant(decodeURIComponent(resendParticipantMatch[1]), operator(input))
    }
    throw new ApiError(404, 'ROUTE_NOT_FOUND')
  }),
)

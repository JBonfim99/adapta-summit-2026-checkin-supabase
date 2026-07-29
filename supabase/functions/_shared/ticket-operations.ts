import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { rpc } from './db.ts'
import { ApiError } from './http.ts'
import { callInac } from './inac.ts'
import { validCpf, validPhone } from './operations.ts'

interface ClaimResult {
  claimId: string
  ticket: {
    id: string
    pedido_id: string
    tipo_ingresso: string
    inac_id?: string | null
  }
  participant: {
    id: string
    nome_completo: string
    email: string
    cpf: string
    telefone: string
    nome_empresa?: string
    profissao?: string
  }
}

export async function mutateCredentialledTicket(
  db: SupabaseClient,
  input: {
    ticketId: string
    operation: 'edit' | 'change_type' | 'delete'
    actor: string
    payload?: Record<string, unknown>
  },
) {
  if (input.operation === 'change_type') {
    const nextType = String(input.payload?.tipo ?? '').toUpperCase()
    const { data: current, error } = await db
      .from('ingressos')
      .select('tipo_ingresso')
      .eq('id', input.ticketId)
      .maybeSingle()
    if (error) throw error
    if (!current) throw new ApiError(404, 'TICKET_NOT_FOUND')
    if (current.tipo_ingresso === nextType) {
      return { success: true, unchanged: true, inac_ok: true }
    }
  }

  if (input.operation === 'edit') {
    const payload = input.payload ?? {}
    const name = String(payload.nome_completo ?? '').trim()
    const email = String(payload.email ?? '')
      .trim()
      .toLowerCase()
    const company = payload.tem_empresa === true || payload.tem_empresa === 'true'
    if (name.length < 3) throw new ApiError(400, 'Nome é obrigatório')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ApiError(400, 'E-mail inválido')
    }
    if (!validCpf(payload.cpf)) throw new ApiError(400, 'CPF inválido')
    if (!validPhone(payload.telefone)) throw new ApiError(400, 'Telefone inválido')
    if (company && String(payload.nome_empresa ?? '').trim().length < 2) {
      throw new ApiError(400, 'Empresa é obrigatória')
    }
    if (
      'tem_empresa' in payload &&
      !company &&
      String(payload.profissao ?? payload.empresa ?? '').trim().length < 2
    ) {
      throw new ApiError(400, 'Profissão é obrigatória')
    }
  }

  const claim = await rpc<ClaimResult>('claim_ticket_operation', {
    p_ticket_id: input.ticketId,
    p_operation: input.operation,
    p_actor: input.actor,
    p_payload: input.payload ?? {},
  })

  const inacOperation = input.operation === 'delete' ? 'delete' : 'edit'
  const inac = claim.ticket.inac_id
    ? await callInac(db, inacOperation, claim.ticket, claim.participant, input.payload)
    : {
        success: true,
        status: 200,
        payload: {},
        response: { skipped: true, reason: 'NO_INAC_ID' },
        mock: false,
      }

  const completion = await rpc<Record<string, unknown>>('complete_ticket_operation', {
    p_claim_id: claim.claimId,
    p_success: inac.success,
    p_provider_result: inac,
  })

  if (!inac.success) {
    throw new ApiError(502, 'INAC_OPERATION_FAILED', inac)
  }
  return {
    ...completion,
    success: true,
    inac_ok: true,
    inac_msg: inac.response,
    inac_deleted: input.operation === 'delete' && Boolean(claim.ticket.inac_id),
  }
}

export async function dispatchCredentialToInac(
  db: SupabaseClient,
  ticketId: string,
  participantId: string,
) {
  const { data: ticket, error: ticketError } = await db
    .from('ingressos')
    .select('id,pedido_id,tipo_ingresso,inac_id')
    .eq('id', ticketId)
    .single()
  const { data: participant, error: participantError } = await db
    .from('participantes')
    .select('id,nome_completo,email,cpf,telefone,nome_empresa,profissao')
    .eq('id', participantId)
    .single()
  if (ticketError || participantError) throw new ApiError(404, 'CREDENTIAL_DATA_NOT_FOUND')

  if (ticket.inac_id) {
    return {
      success: true,
      status: 200,
      inacId: ticket.inac_id,
      qrCode: null,
      response: { already: true },
      mock: false,
    }
  }

  const inac = await callInac(db, 'add', ticket, participant)
  const { error: updateError } = await db
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
  if (updateError) {
    throw new ApiError(500, 'CREDENTIAL_RESULT_PERSIST_FAILED', {
      ticketId: ticket.id,
      inac,
      databaseError: updateError.message,
    })
  }
  return inac
}

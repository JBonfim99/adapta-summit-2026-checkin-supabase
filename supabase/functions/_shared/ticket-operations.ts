import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { rpc } from './db.ts'
import { ApiError } from './http.ts'
import { callInac } from './inac.ts'

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

  await rpc('complete_ticket_operation', {
    p_claim_id: claim.claimId,
    p_success: inac.success,
    p_provider_result: inac,
  })

  if (!inac.success) {
    throw new ApiError(502, 'INAC_OPERATION_FAILED', inac)
  }
  return { success: true, inac_ok: true, inac_msg: inac.response }
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
  return inac
}

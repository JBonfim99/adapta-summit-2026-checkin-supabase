import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { auditIntegration } from './audit.ts'

type InacOperation = 'add' | 'edit' | 'delete'

interface InacTicket {
  id: string
  pedido_id: string
  tipo_ingresso: string
  inac_id?: string | null
}

interface InacParticipant {
  id: string
  nome_completo: string
  email: string
  cpf: string
  telefone: string
  nome_empresa?: string
  profissao?: string
}

export interface InacResult {
  success: boolean
  status: number
  inacId?: string
  qrCode?: string
  payload: Record<string, unknown>
  response: unknown
  error?: string
  mock: boolean
}

const categoryIds: Record<string, number> = {
  GOLD: 6123,
  PLATINUM: 6125,
  PALESTRANTES: 7863,
  HACKATHON: 7864,
}

const onlyDigits = (value = '') => value.replace(/\D/g, '')
const clean = (value = '') => value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()

function endpoint(baseUrl: string, operation: InacOperation): string {
  if (/\/attendees\/(add|edit|delete)\/?$/i.test(baseUrl)) {
    return baseUrl.replace(/\/(add|edit|delete)\/?$/i, `/${operation}`)
  }
  return `${baseUrl.replace(/\/$/, '')}/attendees/${operation}`
}

function makePayload(
  operation: InacOperation,
  ticket: InacTicket,
  participant: InacParticipant,
  overrides: Record<string, unknown>,
) {
  const type = String(overrides.tipo_ingresso ?? ticket.tipo_ingresso)
  if (operation === 'delete') {
    return { id: Number(ticket.inac_id) || ticket.inac_id, event_id: 375 }
  }

  const phoneDigits = onlyDigits(String(overrides.telefone ?? participant.telefone))
  const phone = phoneDigits && phoneDigits.length <= 11 ? `55${phoneDigits}` : phoneDigits
  const payload: Record<string, unknown> = {
    event_id: 375,
    category_id: categoryIds[type] ?? categoryIds.GOLD,
    status: 'active',
    fields: [
      { id: 10133653, value: clean(String(overrides.nome_completo ?? participant.nome_completo)) },
      { id: 10133654, value: clean(String(overrides.email ?? participant.email)).toLowerCase() },
      { id: 10133655, value: onlyDigits(String(overrides.cpf ?? participant.cpf)) },
      { id: 10133656, value: phone },
      {
        id: 10133657,
        value: clean(
          String(
            overrides.nome_empresa ??
              overrides.empresa ??
              participant.nome_empresa ??
              participant.profissao ??
              '',
          ),
        ),
      },
      { id: 10133665, value: clean(ticket.pedido_id) },
    ],
  }
  if (operation === 'edit') payload.id = Number(ticket.inac_id) || ticket.inac_id
  return payload
}

export async function callInac(
  db: SupabaseClient,
  operation: InacOperation,
  ticket: InacTicket,
  participant: InacParticipant,
  overrides: Record<string, unknown> = {},
): Promise<InacResult> {
  const payload = makePayload(operation, ticket, participant, overrides)
  const mode = Deno.env.get('INAC_MODE') ?? 'mock'
  const canaryEmail = (Deno.env.get('INAC_CANARY_EMAIL') ?? '').toLowerCase()
  const shouldMock =
    mode === 'mock' ||
    (mode === 'canary' && participant.email.toLowerCase() !== canaryEmail)
  const idempotencyKey = `${ticket.id}:${operation}:${ticket.inac_id ?? 'new'}`

  if (shouldMock) {
    const response =
      operation === 'delete'
        ? { status: true }
        : {
            status: true,
            attendee: {
              id: ticket.inac_id ?? `mock-${ticket.id}`,
              qrcode: `SUMMIT2026-MOCK-${ticket.id}`,
            },
          }
    await auditIntegration(db, {
      ingressoId: ticket.id,
      participantId: participant.id,
      provider: 'inac',
      operation,
      idempotencyKey,
      attempt: 1,
      requestPayload: payload,
      responseStatus: 200,
      responsePayload: response,
      success: true,
      durationMs: 0,
    })
    return {
      success: true,
      status: 200,
      inacId: String((response as { attendee?: { id?: string } }).attendee?.id ?? ''),
      qrCode: (response as { attendee?: { qrcode?: string } }).attendee?.qrcode,
      payload,
      response,
      mock: true,
    }
  }

  const baseUrl = Deno.env.get('INAC_BASE_URL') ?? ''
  const token = Deno.env.get('INAC_API_KEY') ?? ''
  if (!baseUrl || !token) {
    return { success: false, status: 0, payload, response: null, error: 'INAC_NOT_CONFIGURED', mock: false }
  }

  const maxAttempts = operation === 'add' ? 3 : 1
  let finalResult: InacResult = {
    success: false,
    status: 0,
    payload,
    response: null,
    error: 'INAC_REQUEST_FAILED',
    mock: false,
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = performance.now()
    let status = 0
    let parsed: unknown = null
    let errorMessage: string | undefined
    try {
      const response = await fetch(endpoint(baseUrl, operation), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      })
      status = response.status
      const text = await response.text()
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = { raw: text.slice(0, 500) }
      }

      const data = parsed as { status?: boolean; attendee?: { id?: string | number; qrcode?: string } }
      const success =
        response.ok &&
        data?.status === true &&
        (operation === 'delete' || Boolean(data.attendee))
      finalResult = {
        success,
        status,
        inacId: data?.attendee?.id == null ? undefined : String(data.attendee.id),
        qrCode: data?.attendee?.qrcode,
        payload,
        response: parsed,
        error: success ? undefined : `INAC_HTTP_${status}`,
        mock: false,
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'INAC_NETWORK_ERROR'
      finalResult = {
        success: false,
        status,
        payload,
        response: parsed,
        error: errorMessage,
        mock: false,
      }
    }

    await auditIntegration(db, {
      ingressoId: ticket.id,
      participantId: participant.id,
      provider: 'inac',
      operation,
      idempotencyKey,
      attempt,
      requestPayload: payload,
      responseStatus: status,
      responsePayload: parsed,
      success: finalResult.success,
      error: finalResult.error ?? errorMessage,
      durationMs: Math.round(performance.now() - started),
    })

    if (finalResult.success) return finalResult
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  return finalResult
}

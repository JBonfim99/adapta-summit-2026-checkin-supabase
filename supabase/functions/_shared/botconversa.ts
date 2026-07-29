import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { auditIntegration } from './audit.ts'

export interface WhatsAppRecipient {
  buyerId: string
  nome: string
  email: string
  telefone: string
  documento?: string
  pedidoId?: string
  flow: string
  mapping?: Array<{ field_id?: string; source?: string; value?: string }>
  token?: string
  dispatchId: string
  attempt: number
}

const apiBase = 'https://backend.botconversa.com.br/api/v1/webhook'

function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits && digits.length <= 11 ? `55${digits}` : digits
}

async function botRequest(path: string, init: RequestInit = {}) {
  const key = Deno.env.get('BOTCONVERSA_API_KEY') ?? ''
  if (!key) throw new Error('BOTCONVERSA_API_KEY_NOT_CONFIGURED')
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'API-KEY': key,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { body: text.slice(0, 500) }
  }
  if (!response.ok) {
    throw new Error(`BOTCONVERSA_HTTP_${response.status}:${text.slice(0, 300)}`)
  }
  return { status: response.status, data }
}

export async function listBotConversaFlows() {
  return botRequest('/flows/')
}

export async function listBotConversaCustomFields() {
  return botRequest('/custom_fields/')
}

function mappedValue(
  row: { source?: string; value?: string },
  input: WhatsAppRecipient,
  phone: string,
) {
  const firstName = input.nome.trim().split(/\s+/)[0] || input.nome
  const values: Record<string, string> = {
    primeiro_nome: firstName,
    nome: input.nome,
    email: input.email,
    telefone: phone,
    documento: input.documento ?? '',
    pedido_id: input.pedidoId ?? '',
    token: input.token ?? '',
    link_acesso: `${(Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')}/acesso?token=${encodeURIComponent(input.token ?? '')}`,
    static: row.value ?? '',
  }
  return values[row.source ?? ''] ?? ''
}

export async function sendBotConversa(db: SupabaseClient, input: WhatsAppRecipient) {
  const mode =
    Deno.env.get('BOTCONVERSA_MODE') ??
    (Deno.env.get('BOTCONVERSA_API_KEY') || Deno.env.get('BOTCONVERSA_CATCH_URL')
      ? 'live'
      : 'mock')
  const phone = phoneDigits(input.telefone)
  const started = performance.now()
  const idempotencyKey = `whatsapp:${input.dispatchId}:${input.buyerId}`

  try {
    if (!phone) throw new Error('COMPRADOR_SEM_TELEFONE')
    if (mode === 'mock') {
      await auditIntegration(db, {
        provider: 'botconversa',
        operation: input.flow === 'PRE' || !input.flow ? 'catch' : 'send_flow',
        idempotencyKey,
        attempt: input.attempt,
        requestPayload: { buyerId: input.buyerId, phone, flow: input.flow, mock: true },
        responseStatus: 202,
        responsePayload: { mock: true },
        success: true,
        durationMs: 0,
      })
      return { success: true, status: 202, mock: true }
    }

    let responseStatus = 0
    let responsePayload: unknown = {}
    if (input.flow === 'PRE' || !input.flow) {
      const catchUrl = Deno.env.get('BOTCONVERSA_CATCH_URL') ?? ''
      if (!catchUrl) throw new Error('BOTCONVERSA_CATCH_URL_NOT_CONFIGURED')
      const response = await fetch(catchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: input.nome,
          email: input.email,
          phone,
          token: input.token ?? '',
        }),
      })
      const text = await response.text()
      responseStatus = response.status
      responsePayload = { body: text.slice(0, 500) }
      if (!response.ok) throw new Error(`BOTCONVERSA_CATCH_HTTP_${response.status}`)
    } else {
      let subscriberId = 0
      try {
        const lookup = await botRequest(`/subscriber/get_by_phone/${phone}/`)
        subscriberId = Number(lookup.data.id ?? 0)
      } catch (error) {
        if (!String(error).includes('HTTP_404')) throw error
      }
      if (!subscriberId) {
        const names = input.nome.trim().split(/\s+/)
        const created = await botRequest('/subscriber/', {
          method: 'POST',
          body: JSON.stringify({
            phone,
            first_name: names[0] || 'Contato',
            last_name: names.slice(1).join(' '),
            has_opt_in_whatsapp: true,
          }),
        })
        subscriberId = Number(created.data.id ?? 0)
        if (!subscriberId) {
          const lookup = await botRequest(`/subscriber/get_by_phone/${phone}/`)
          subscriberId = Number(lookup.data.id ?? 0)
        }
      }
      if (!subscriberId) throw new Error('BOTCONVERSA_SUBSCRIBER_NOT_FOUND')

      for (const row of input.mapping ?? []) {
        if (!row.field_id || !row.source) continue
        const value = mappedValue(row, input, phone)
        if (value === '') continue
        await botRequest(`/subscriber/${subscriberId}/custom_fields/${row.field_id}/`, {
          method: 'POST',
          body: JSON.stringify({ value }),
        })
      }
      const sent = await botRequest(`/subscriber/${subscriberId}/send_flow/`, {
        method: 'POST',
        body: JSON.stringify({ flow: Number(input.flow) }),
      })
      responseStatus = sent.status
      responsePayload = sent.data
    }

    await auditIntegration(db, {
      provider: 'botconversa',
      operation: input.flow === 'PRE' || !input.flow ? 'catch' : 'send_flow',
      idempotencyKey,
      attempt: input.attempt,
      requestPayload: { buyerId: input.buyerId, phone, flow: input.flow },
      responseStatus,
      responsePayload,
      success: true,
      durationMs: Math.round(performance.now() - started),
    })
    return { success: true, status: responseStatus, mock: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BOTCONVERSA_FAILED'
    await auditIntegration(db, {
      provider: 'botconversa',
      operation: input.flow === 'PRE' || !input.flow ? 'catch' : 'send_flow',
      idempotencyKey,
      attempt: input.attempt,
      requestPayload: { buyerId: input.buyerId, phone, flow: input.flow },
      responseStatus: Number(message.match(/HTTP_(\d+)/)?.[1] ?? 0),
      responsePayload: {},
      success: false,
      error: message,
      durationMs: Math.round(performance.now() - started),
    })
    return { success: false, status: 0, error: message }
  }
}

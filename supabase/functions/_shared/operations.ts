import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { adminDb } from './db.ts'
import { ApiError } from './http.ts'

export const ticketTypes = ['GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON'] as const

export function normalizeEmail(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function cpfDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

export function validCpf(value: unknown) {
  const cpf = cpfDigits(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  let sum = 0
  for (let index = 0; index < 9; index += 1) sum += Number(cpf[index]) * (10 - index)
  let first = 11 - (sum % 11)
  if (first >= 10) first = 0
  if (first !== Number(cpf[9])) return false
  sum = 0
  for (let index = 0; index < 10; index += 1) sum += Number(cpf[index]) * (11 - index)
  let second = 11 - (sum % 11)
  if (second >= 10) second = 0
  return second === Number(cpf[10])
}

export function validPhone(value: unknown) {
  return String(value ?? '').replace(/\D/g, '').length >= 10
}

export async function requireOperationalWrite(db = adminDb()) {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  if (
    Deno.env.get('ALLOW_STANDBY_WRITES') === 'true' ||
    url.includes('127.0.0.1') ||
    url.includes('localhost')
  ) {
    return
  }
  const { data, error } = await db
    .from('system_state')
    .select('mode')
    .eq('singleton', true)
    .single()
  if (error) throw error
  if (data.mode !== 'active') throw new ApiError(503, 'FALLBACK_STANDBY')
}

export async function requireExternalEffectsEnabled(db = adminDb()) {
  const { data, error } = await db
    .from('system_state')
    .select('mode,external_effects_enabled')
    .eq('singleton', true)
    .single()
  if (error) throw error
  if (data.mode !== 'active' || data.external_effects_enabled !== true) {
    throw new ApiError(503, 'EXTERNAL_EFFECTS_DISABLED')
  }
}

export async function auditEvent(
  db: SupabaseClient,
  input: {
    ingressoId?: string | null
    evento: string
    detalhe: string
    method?: string
    status?: number
    payload?: Record<string, unknown>
    response?: string
  },
) {
  const { error } = await db.from('webhooks_log').insert({
    ingresso_id: input.ingressoId || null,
    evento: input.evento,
    detalhe: input.detalhe,
    method: input.method ?? 'POST',
    status: input.status ?? 200,
    payload: input.payload ? JSON.stringify(input.payload) : null,
    response: input.response ?? null,
    metadata: input.payload ?? {},
  })
  if (error) throw error
}

export function nextRetryDate(attempts: number) {
  const seconds = Math.min(900, 15 * 2 ** Math.max(0, attempts - 1))
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export async function createParticipantViewToken(db: SupabaseClient, ticketId: string, days = 60) {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await db.from('links_participante').insert({
    ingresso_id: ticketId,
    token,
    usado: true,
    expira_em: expiresAt,
  })
  if (error) throw error
  return { token, expiresAt }
}

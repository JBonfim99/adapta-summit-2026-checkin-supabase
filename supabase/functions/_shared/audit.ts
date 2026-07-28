import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

export interface IntegrationAudit {
  ingressoId?: string | null
  participantId?: string | null
  provider: 'inac' | 'sendgrid'
  operation: string
  idempotencyKey: string
  attempt: number
  requestPayload?: unknown
  responseStatus?: number | null
  responsePayload?: unknown
  success: boolean
  error?: string | null
  durationMs?: number | null
}

export async function auditIntegration(db: SupabaseClient, audit: IntegrationAudit) {
  const { error } = await db.from('integration_attempts').insert({
    ingresso_id: audit.ingressoId ?? null,
    participant_id: audit.participantId ?? null,
    provider: audit.provider,
    operation: audit.operation,
    idempotency_key: audit.idempotencyKey,
    attempt: audit.attempt,
    request_payload: audit.requestPayload ?? {},
    response_status: audit.responseStatus ?? null,
    response_payload: audit.responsePayload ?? null,
    success: audit.success,
    error: audit.error ?? null,
    duration_ms: audit.durationMs ?? null,
  })
  if (error) console.error('INTEGRATION_AUDIT_FAILED', error.message)
}

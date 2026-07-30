import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { auditIntegration } from './audit.ts'
import { requireExternalEffectsEnabled } from './operations.ts'

interface SendEmailInput {
  to: string
  templateId?: string
  subject: string
  html: string
  dynamicData?: Record<string, unknown>
  idempotencyKey: string
  operation: string
  attempt?: number
}

export const sendGridTemplateNames = {
  magicLink: 'Skip-Summit26-Magiclink-acesso',
  buyerInitial: 'Skip-Summit26-Send-Comprador',
  buyerFollowup: 'Skip-Summit26-Send-Comprador-Email02',
  participant: 'Skip-Summit26-Send-Participante',
} as const

const templateEnvByName: Record<string, string[]> = {
  [sendGridTemplateNames.magicLink]: [
    'SENDGRID_MAGICLINK_TEMPLATE_ID',
    'SENDGRID_BUYER_TEMPLATE_ID',
  ],
  [sendGridTemplateNames.buyerInitial]: [
    'SENDGRID_BUYER_INITIAL_TEMPLATE_ID',
    'SENDGRID_BUYER_TEMPLATE_ID',
  ],
  [sendGridTemplateNames.buyerFollowup]: ['SENDGRID_BUYER_TEMPLATE_ID'],
  [sendGridTemplateNames.participant]: ['SENDGRID_PARTICIPANT_TEMPLATE_ID'],
}

const mockTemplateIds: Record<string, string> = {
  [sendGridTemplateNames.magicLink]: 'd-mock-summit26-magiclink',
  [sendGridTemplateNames.buyerInitial]: 'd-mock-summit26-comprador',
  [sendGridTemplateNames.buyerFollowup]: 'd-mock-summit26-comprador-email02',
  [sendGridTemplateNames.participant]: 'd-mock-summit26-participante',
}

export function sendGridTemplateId(name: string): string {
  for (const envName of templateEnvByName[name] ?? []) {
    const value = Deno.env.get(envName) ?? ''
    if (value) return value
  }
  return (Deno.env.get('SENDGRID_MODE') ?? 'mock') === 'mock' ? (mockTemplateIds[name] ?? '') : ''
}

export function configuredSendGridTemplates() {
  return Object.values(sendGridTemplateNames)
    .map((name) => ({ id: sendGridTemplateId(name), name }))
    .filter((template) => template.id)
}

export async function sendEmail(db: SupabaseClient, input: SendEmailInput) {
  await requireExternalEffectsEnabled(db)
  const apiKey = Deno.env.get('SENDGRID_API_KEY') ?? ''
  const mode = Deno.env.get('SENDGRID_MODE') ?? (apiKey ? 'live' : 'mock')
  const fromEmail = Deno.env.get('SENDGRID_FROM_EMAIL') ?? ''
  const fromName = Deno.env.get('SENDGRID_FROM_NAME') ?? 'Adapta Summit 2026'

  if (mode === 'mock') {
    await auditIntegration(db, {
      provider: 'sendgrid',
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      attempt: input.attempt ?? 1,
      requestPayload: { to: input.to, templateId: input.templateId, mock: true },
      responseStatus: 202,
      responsePayload: { mock: true },
      success: true,
      durationMs: 0,
    })
    return { success: true, mock: true }
  }

  if (!apiKey || !fromEmail) throw new Error('SENDGRID_NOT_CONFIGURED')
  const payload = input.templateId
    ? {
        personalizations: [
          { to: [{ email: input.to }], dynamic_template_data: input.dynamicData ?? {} },
        ],
        from: { email: fromEmail, name: fromName },
        template_id: input.templateId,
      }
    : {
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: fromEmail, name: fromName },
        subject: input.subject,
        content: [{ type: 'text/html', value: input.html }],
      }

  const started = performance.now()
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const responseText = await response.text()
  await auditIntegration(db, {
    provider: 'sendgrid',
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    attempt: input.attempt ?? 1,
    requestPayload: { to: input.to, templateId: input.templateId },
    responseStatus: response.status,
    responsePayload: { body: responseText.slice(0, 500) },
    success: response.ok,
    error: response.ok ? null : `SENDGRID_HTTP_${response.status}`,
    durationMs: Math.round(performance.now() - started),
  })
  if (!response.ok) throw new Error(`SENDGRID_HTTP_${response.status}`)
  return { success: true, mock: false }
}

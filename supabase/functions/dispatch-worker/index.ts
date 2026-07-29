import { adminDb } from '../_shared/db.ts'
import { handler, json } from '../_shared/http.ts'
import { sendEmail } from '../_shared/sendgrid.ts'
import { sendBotConversa } from '../_shared/botconversa.ts'
import {
  createParticipantViewToken,
  requireOperationalWrite,
} from '../_shared/operations.ts'

type AnyRow = Record<string, any>

function workerAuthorized(req: Request) {
  const supplied = req.headers.get('X-Worker-Key') ?? ''
  const expected = Deno.env.get('DISPATCH_WORKER_SECRET') ?? ''
  if (!expected || supplied.length !== expected.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  }
  return mismatch === 0
}

async function ensureBuyerToken(buyerId: string) {
  const db = adminDb()
  const { data: existing } = await db
    .from('tokens_acesso')
    .select('token')
    .eq('comprador_id', buyerId)
    .eq('usado', false)
    .gt('expira_em', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing?.token) return existing.token
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const { error } = await db.from('tokens_acesso').insert({
    comprador_id: buyerId,
    token,
    expira_em: new Date(Date.now() + 60 * 86400000).toISOString(),
  })
  if (error) throw error
  return token
}

async function ensureParticipantToken(participantId: string) {
  const db = adminDb()
  const { data: participant, error } = await db
    .from('participantes')
    .select('ingresso_id')
    .eq('id', participantId)
    .single()
  if (error) throw error
  return (await createParticipantViewToken(db, participant.ingresso_id)).token
}

async function processEmailDelivery(delivery: AnyRow, dispatch: AnyRow) {
  const db = adminDb()
  try {
    const token = delivery.comprador_id
      ? await ensureBuyerToken(delivery.comprador_id)
      : await ensureParticipantToken(delivery.participante_id)
    const appUrl = (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '')
    const path = delivery.comprador_id ? 'acesso' : 'ingresso'
    await sendEmail(db, {
      to: delivery.email,
      templateId: dispatch.template_id,
      subject: dispatch.template_nome || 'Adapta Summit 2026',
      html: `<p><a href="${appUrl}/${path}?token=${encodeURIComponent(token)}">Acessar</a></p>`,
      dynamicData: {
        firstname: String(delivery.nome ?? '').trim().split(/\s+/)[0] || delivery.nome,
        nome: delivery.nome,
        token,
        access_url: `${appUrl}/${path}?token=${encodeURIComponent(token)}`,
      },
      idempotencyKey: `dispatch:${delivery.id}`,
      operation: 'bulk_dispatch',
      attempt: delivery.tentativas,
    })
    await db.rpc('complete_email_dispatch', {
      p_delivery_id: delivery.id,
      p_success: true,
      p_error: null,
    })
    const table = delivery.comprador_id ? 'compradores' : 'participantes'
    const id = delivery.comprador_id ?? delivery.participante_id
    await db
      .from(table)
      .update({
        acesso_status: 'enviado',
        acesso_enviado_em: new Date().toISOString(),
        acesso_erro: null,
        acesso_claim: null,
        acesso_tentativas: delivery.tentativas,
      })
      .eq('id', id)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SEND_FAILED'
    await db.rpc('complete_email_dispatch', {
      p_delivery_id: delivery.id,
      p_success: false,
      p_error: message,
    })
    const table = delivery.comprador_id ? 'compradores' : 'participantes'
    const id = delivery.comprador_id ?? delivery.participante_id
    await db
      .from(table)
      .update({
        acesso_status: 'erro',
        acesso_erro: message.slice(0, 1000),
        acesso_claim: null,
        acesso_tentativas: delivery.tentativas,
      })
      .eq('id', id)
    return false
  }
}

async function processEmailBatch() {
  const db = adminDb()
  const { data: deliveries, error } = await db.rpc('claim_email_dispatch_batch', {
    p_limit: 500,
  })
  if (error) throw error
  if (!deliveries?.length) return { claimed: 0, sent: 0, failed: 0 }
  const dispatchIds = [...new Set(deliveries.map((delivery: AnyRow) => delivery.disparo_id))]
  const { data: dispatches, error: dispatchError } = await db
    .from('disparos')
    .select('id,template_id,template_nome')
    .in('id', dispatchIds)
  if (dispatchError) throw dispatchError
  const dispatchMap = new Map((dispatches ?? []).map((dispatch) => [dispatch.id, dispatch]))
  let sent = 0
  let failed = 0
  for (let index = 0; index < deliveries.length; index += 20) {
    const results = await Promise.all(
      deliveries.slice(index, index + 20).map((delivery: AnyRow) => {
        const dispatch = dispatchMap.get(delivery.disparo_id)
        if (!dispatch) throw new Error('DISPATCH_NOT_FOUND')
        return processEmailDelivery(delivery, dispatch)
      }),
    )
    sent += results.filter(Boolean).length
    failed += results.filter((value) => !value).length
  }
  return { claimed: deliveries.length, sent, failed }
}

async function processWhatsappBuyer(row: AnyRow) {
  const db = adminDb()
  try {
    const token = row.token || (await ensureBuyerToken(row.buyer_id))
    const [{ data: buyer }, { data: ticket }] = await Promise.all([
      db
        .from('compradores')
        .select('documento')
        .eq('id', row.buyer_id)
        .single(),
      db
        .from('ingressos')
        .select('pedido_id')
        .eq('comprador_id', row.buyer_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const result = await sendBotConversa(db, {
      buyerId: row.buyer_id,
      nome: row.nome,
      email: row.email,
      telefone: row.telefone,
      documento: buyer?.documento ?? '',
      pedidoId: ticket?.pedido_id ?? '',
      flow: row.flow,
      mapping: row.mapping,
      token,
      dispatchId: row.dispatch_id,
      attempt: row.attempt ?? 1,
    })
    await db.rpc('complete_whatsapp_dispatch', {
      p_buyer_id: row.buyer_id,
      p_success: result.success,
      p_error: result.success ? null : result.error,
    })
    return result.success
  } catch (error) {
    await db.rpc('complete_whatsapp_dispatch', {
      p_buyer_id: row.buyer_id,
      p_success: false,
      p_error: error instanceof Error ? error.message : 'WHATSAPP_FAILED',
    })
    return false
  }
}

async function processWhatsappBatch() {
  const db = adminDb()
  const { data: buyers, error } = await db.rpc('claim_whatsapp_dispatch_batch', {
    p_limit: 100,
  })
  if (error) throw error
  if (!buyers?.length) return { claimed: 0, sent: 0, failed: 0 }
  const results: boolean[] = []
  for (let index = 0; index < buyers.length; index += 10) {
    results.push(
      ...(await Promise.all(buyers.slice(index, index + 10).map(processWhatsappBuyer))),
    )
  }
  return {
    claimed: buyers.length,
    sent: results.filter(Boolean).length,
    failed: results.filter((value) => !value).length,
  }
}

Deno.serve((req) =>
  handler(req, async () => {
    if (!workerAuthorized(req)) return json({ error: 'WORKER_ACCESS_DENIED' }, 401)
    await requireOperationalWrite()
    const startedAt = new Date().toISOString()
    const [email, whatsapp] = await Promise.all([processEmailBatch(), processWhatsappBatch()])
    const completedAt = new Date().toISOString()
    await adminDb()
      .from('cron_health')
      .upsert({
        id: 'dispatch',
        last_run: completedAt,
        email_last_run: completedAt,
        whatsapp_last_run: completedAt,
        metadata: { started_at: startedAt, completed_at: completedAt, email, whatsapp },
      })
    return json({ success: true, email, whatsapp, completed_at: completedAt })
  }),
)

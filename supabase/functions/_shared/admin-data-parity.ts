import { adminDb, rpc } from './db.ts'
import { ApiError, body, json } from './http.ts'
import {
  auditEvent,
  cpfDigits,
  normalizeEmail,
  requireOperationalWrite,
  ticketTypes,
} from './operations.ts'

type AnyRow = Record<string, any>

async function allRows(table: string, columns = '*') {
  const db = adminDb()
  const result: AnyRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .range(from, from + 999)
    if (error) throw error
    result.push(...(data ?? []))
    if (!data || data.length < 1000) return result
  }
}

async function queueImportEmail(buyerIds: string[], existingDispatchId: string) {
  const db = adminDb()
  const templateId = Deno.env.get('SENDGRID_IMPORT_TEMPLATE_ID') ?? ''
  if (!templateId) {
    return {
      skipped: true,
      reason: 'SENDGRID_IMPORT_TEMPLATE_ID nao configurado',
      queued: 0,
      disparo_id: '',
    }
  }

  let dispatchId = existingDispatchId
  if (!dispatchId) {
    const { data: dispatch, error } = await db
      .from('disparos')
      .insert({
        template_id: templateId,
        template_nome: Deno.env.get('SENDGRID_IMPORT_TEMPLATE_NAME') ?? 'Importacao de compradores',
        cluster: 'individual',
        nome: 'Importacao de compradores',
        audience: 'compradores',
      })
      .select('id')
      .single()
    if (error) throw error
    dispatchId = dispatch.id
  }

  const { data: buyers, error } = await db
    .from('compradores')
    .select('id,nome,email')
    .in('id', buyerIds)
  if (error) throw error
  const { data: existing } = await db
    .from('envios')
    .select('comprador_id')
    .eq('disparo_id', dispatchId)
    .in('comprador_id', buyerIds)
  const queuedIds = new Set((existing ?? []).map((delivery) => delivery.comprador_id))
  const deliveries = (buyers ?? [])
    .filter((buyer) => !queuedIds.has(buyer.id))
    .map((buyer) => ({
      disparo_id: dispatchId,
      comprador_id: buyer.id,
      nome: buyer.nome,
      email: buyer.email,
      status: 'na_fila',
    }))
  if (deliveries.length > 0) {
    const { error: insertError } = await db.from('envios').insert(deliveries)
    if (insertError) throw insertError
  }
  const { count } = await db
    .from('envios')
    .select('*', { count: 'exact', head: true })
    .eq('disparo_id', dispatchId)
  await db
    .from('disparos')
    .update({ total: count ?? deliveries.length, status: 'em_andamento' })
    .eq('id', dispatchId)
  return { skipped: false, queued: deliveries.length, disparo_id: dispatchId }
}

async function importBuyers(req: Request) {
  await requireOperationalWrite()
  const input = await body<{
    rows?: AnyRow[]
    enviar_email?: boolean
    disparo_id?: string
  }>(req)
  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 500) : []
  if (rows.length === 0) throw new ApiError(400, 'ROWS_REQUIRED')
  const result = await rpc<{ imported: number; buyer_ids: string[] }>('import_buyers_batch', {
    p_rows: rows,
  })
  const email = input.enviar_email
    ? await queueImportEmail(result.buyer_ids ?? [], String(input.disparo_id ?? ''))
    : { skipped: true, reason: 'envio desativado', queued: 0, disparo_id: '' }
  await auditEvent(adminDb(), {
    evento: 'admin_importacao',
    detalhe: `${result.imported} ingresso(s) importado(s)`,
    payload: { rows: rows.length, imported: result.imported, email },
  })
  return json({ imported: result.imported, email })
}

async function reconcileTickets(req: Request) {
  const input = await body<{ rows?: AnyRow[] }>(req)
  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 500) : []
  const [buyers, tickets] = await Promise.all([
    allRows('compradores', 'id,nome,email,email_normalized,documento'),
    allRows(
      'ingressos',
      'id,comprador_id,pedido_id,status,tipo_ingresso,participante_id,inac_id,created_at',
    ),
  ])
  const byEmail = new Map(buyers.map((buyer) => [buyer.email_normalized, buyer]))
  const byCpf = new Map(
    buyers
      .map((buyer) => [cpfDigits(buyer.documento), buyer] as const)
      .filter(([cpf]) => Boolean(cpf)),
  )
  const ticketsByBuyer = new Map<string, AnyRow[]>()
  for (const ticket of tickets) {
    const list = ticketsByBuyer.get(ticket.comprador_id) ?? []
    list.push(ticket)
    ticketsByBuyer.set(ticket.comprador_id, list)
  }
  const classifications = {
    ok: 0,
    excesso: 0,
    faltando: 0,
    comprador_nao_encontrado: 0,
  }
  const anomalies: AnyRow[] = []

  for (const row of rows) {
    const email = normalizeEmail(row.email)
    const cpf = cpfDigits(row.cpf)
    const expected = Math.max(Number(row.ingressos_esperado ?? 0) || 0, 0)
    const buyer = byEmail.get(email) ?? (cpf ? byCpf.get(cpf) : undefined)
    if (!buyer) {
      classifications.comprador_nao_encontrado += 1
      anomalies.push({
        classificacao: 'comprador_nao_encontrado',
        nome: String(row.nome ?? ''),
        email,
        cpf,
        categorias: String(row.categorias ?? ''),
        esperado: expected,
        atual: 0,
        tickets: [],
      })
      continue
    }
    const buyerTickets = ticketsByBuyer.get(buyer.id) ?? []
    const actual = buyerTickets.length
    const classification = actual === expected ? 'ok' : actual > expected ? 'excesso' : 'faltando'
    classifications[classification] += 1
    if (classification !== 'ok') {
      anomalies.push({
        classificacao: classification,
        comprador_id: buyer.id,
        nome: buyer.nome,
        email: buyer.email,
        cpf: cpfDigits(buyer.documento),
        categorias: String(row.categorias ?? ''),
        esperado: expected,
        atual: actual,
        diferenca: actual - expected,
        tickets: buyerTickets.map((ticket) => ({
          ...ticket,
          created: ticket.created_at,
        })),
      })
    }
  }
  return json({ classificacoes: classifications, anomalias: anomalies, totalLinhas: rows.length })
}

function reconciliationSplit(categories: unknown, total: number) {
  if (total <= 0) return null
  const value = String(categories ?? '').toLowerCase()
  const gold = value.includes('gold')
  const platinum = value.includes('platinum')
  if (gold && !platinum) return { GOLD: total, PLATINUM: 0 }
  if (platinum && !gold) return { GOLD: 0, PLATINUM: total }
  if (gold && platinum && total === 1) return { GOLD: 0, PLATINUM: 1 }
  if (gold && platinum && total === 2) return { GOLD: 1, PLATINUM: 1 }
  return null
}

async function createReconciliationBuyers(req: Request) {
  await requireOperationalWrite()
  const input = await body<{ rows?: AnyRow[] }>(req)
  const rows = Array.isArray(input.rows) ? input.rows.slice(0, 100) : []
  const output = {
    criados: 0,
    ingressos_criados: 0,
    ja_existiam: 0,
    indefinidos: [] as AnyRow[],
    erros: [] as AnyRow[],
  }
  const db = adminDb()
  const existingBuyers = await allRows('compradores', 'id,email_normalized,documento')
  const buyerEmails = new Set(existingBuyers.map((buyer) => buyer.email_normalized))
  const buyerCpfs = new Set(existingBuyers.map((buyer) => cpfDigits(buyer.documento)).filter(Boolean))

  for (const row of rows) {
    const email = normalizeEmail(row.email)
    const cpf = cpfDigits(row.cpf)
    const expected = Math.max(Number(row.ingressos_esperado ?? 0) || 0, 0)
    if (!email) {
      output.erros.push({ ...row, erro: 'Linha sem email' })
      continue
    }
    if (buyerEmails.has(email) || (cpf && buyerCpfs.has(cpf))) {
      output.ja_existiam += 1
      continue
    }
    const split = reconciliationSplit(row.categorias, expected)
    if (!split) {
      output.indefinidos.push({
        nome: String(row.nome ?? ''),
        email,
        cpf,
        categorias: String(row.categorias ?? ''),
        esperado: expected,
        motivo:
          expected <= 0
            ? 'Total de ingressos zerado'
            : `Categoria mista com ${expected} ingressos: nao da para saber quantos de cada`,
      })
      continue
    }
    try {
      const { data: buyer, error } = await db
        .from('compradores')
        .insert({
          nome: String(row.nome ?? '').trim() || email,
          email,
          documento: cpf,
          uf: String(row.uf ?? ''),
          cidade: String(row.cidade ?? ''),
          telefone: String(row.telefone ?? ''),
        })
        .select('id')
        .single()
      if (error) throw error
      let created = 0
      for (const [type, count] of Object.entries(split)) {
        for (let index = 0; index < count; index += 1) {
          await rpc('create_admin_ticket', {
            p_buyer_id: buyer.id,
            p_ticket_type: type,
            p_order_id: null,
            p_origin: 'reconciliacao',
          })
          created += 1
        }
      }
      output.criados += 1
      output.ingressos_criados += created
      buyerEmails.add(email)
      if (cpf) buyerCpfs.add(cpf)
    } catch (error) {
      output.erros.push({
        ...row,
        erro: error instanceof Error ? error.message : 'Erro ao criar',
      })
    }
  }
  await auditEvent(db, {
    evento: 'admin_reconciliacao_criacao',
    detalhe: `${output.criados} comprador(es) criado(s) na reconciliacao`,
    payload: output,
  })
  return json(output)
}

async function listCourtesies() {
  const { data, error } = await adminDb()
    .from('cortesias')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return json({
    cortesias: (data ?? []).map((courtesy) => ({
      ...courtesy,
      created: courtesy.created_at,
      updated: courtesy.updated_at,
    })),
  })
}

async function createCourtesy(req: Request) {
  await requireOperationalWrite()
  const input = await body<AnyRow>(req)
  const type = String(input.tipo_ingresso ?? 'GOLD').toUpperCase()
  if (!ticketTypes.includes(type as (typeof ticketTypes)[number])) {
    throw new ApiError(400, 'TICKET_TYPE_INVALID')
  }
  const courtesy = await rpc<AnyRow>('create_courtesy', {
    p_host: String(input.anfitriao ?? ''),
    p_ticket_type: type,
    p_limit: Math.max(Number(input.limite ?? 0) || 0, 0),
  })
  await auditEvent(adminDb(), {
    evento: 'admin_cortesia_criada',
    detalhe: `Cortesia criada para ${courtesy.anfitriao}`,
    payload: { cortesia_id: courtesy.id, limite: courtesy.limite, tipo: courtesy.tipo_ingresso },
  })
  return json({ success: true, ...courtesy })
}

async function toggleCourtesy(id: string) {
  await requireOperationalWrite()
  const db = adminDb()
  const { data: current } = await db
    .from('cortesias')
    .select('id,ativo,anfitriao')
    .eq('id', id)
    .maybeSingle()
  if (!current) throw new ApiError(404, 'CORTESIA_NOT_FOUND')
  const { data, error } = await db
    .from('cortesias')
    .update({ ativo: !current.ativo })
    .eq('id', id)
    .select('ativo')
    .single()
  if (error) throw error
  await auditEvent(db, {
    evento: 'admin_cortesia_alterada',
    detalhe: `${current.anfitriao}: ${data.ativo ? 'ativada' : 'desativada'}`,
    payload: { cortesia_id: id, ativo: data.ativo },
  })
  return json({ success: true, ativo: data.ativo })
}

async function courtesyRecords(id: string) {
  const { data, error } = await adminDb()
    .from('ingressos')
    .select(
      'id,pedido_id,status,inac_id,created_at,participantes!participantes_ingresso_id_fkey(nome_completo,email,cpf)',
    )
    .eq('cortesia_id', id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return json({
    registros: (data ?? []).map((ticket: AnyRow) => {
      const participant = Array.isArray(ticket.participantes)
        ? ticket.participantes[0]
        : ticket.participantes
      return {
        ingresso_id: ticket.id,
        pedido_id: ticket.pedido_id,
        status: ticket.status,
        credenciado: Boolean(ticket.inac_id),
        nome: participant?.nome_completo ?? '',
        email: participant?.email ?? '',
        cpf: participant?.cpf ?? '',
        created: ticket.created_at,
      }
    }),
  })
}

export async function handleAdminDataParity(
  req: Request,
  path: string,
): Promise<Response | null> {
  if (req.method === 'POST' && path === '/backend/v1/admin/import-buyers') {
    return importBuyers(req)
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/reconciliar-ingressos') {
    return reconcileTickets(req)
  }
  if (
    req.method === 'POST' &&
    path === '/backend/v1/admin/reconciliar-criar-compradores'
  ) {
    return createReconciliationBuyers(req)
  }
  if (req.method === 'GET' && path === '/backend/v1/admin/cortesias') {
    return listCourtesies()
  }
  if (req.method === 'POST' && path === '/backend/v1/admin/cortesias/create') {
    return createCourtesy(req)
  }
  const toggle = path.match(/^\/backend\/v1\/admin\/cortesias\/([^/]+)\/toggle$/)
  if (req.method === 'POST' && toggle) return toggleCourtesy(decodeURIComponent(toggle[1]))
  const records = path.match(/^\/backend\/v1\/admin\/cortesias\/([^/]+)\/registros$/)
  if (req.method === 'GET' && records) return courtesyRecords(decodeURIComponent(records[1]))
  return null
}

import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

async function parseEnv(path) {
  const text = await readFile(path, 'utf8')
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

const frontend = await parseEnv('.env.local')
const functions = await parseEnv('supabase/.env.local')
const supabaseUrl = frontend.VITE_SUPABASE_URL
const publishableKey = frontend.VITE_SUPABASE_PUBLISHABLE_KEY
const functionsUrl = `${supabaseUrl}/functions/v1`

if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error('A verificacao E2E aceita somente o Supabase local.')
}

async function request(name, functionName, path, init = {}) {
  const response = await fetch(`${functionsUrl}/${functionName}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

async function expectError(name, functionName, path, expectedStatus, expectedMessage, init = {}) {
  const response = await fetch(`${functionsUrl}/${functionName}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const data = await response.json()
  if (response.status !== expectedStatus || !String(data.message ?? '').includes(expectedMessage)) {
    throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(data)}`)
  }
}

function cpfFor(seed) {
  const base = String(seed).replace(/\D/g, '').padStart(9, '1').slice(-9).split('').map(Number)
  const digit = (numbers, weight) => {
    const sum = numbers.reduce((total, number, index) => total + number * (weight - index), 0)
    const value = 11 - (sum % 11)
    return value >= 10 ? 0 : value
  }
  const first = digit(base, 10)
  const second = digit([...base, first], 11)
  return [...base, first, second].join('')
}

const buyer = await request(
  'Acesso do comprador',
  'public-api',
  '/backend/v1/auth/magic-link/consume',
  {
    method: 'POST',
    body: JSON.stringify({ token: 'e2e-local-buyer-token-2026' }),
  },
)

await expectError(
  'E-mail desconhecido no login',
  'public-api',
  '/backend/v1/auth/magic-link',
  400,
  'Não encontramos este e-mail',
  {
    method: 'POST',
    body: JSON.stringify({ email: 'nao-cadastrado@adapta.test' }),
  },
)

const tickets = await request('Ingressos do comprador', 'buyer-api', '/backend/v1/buyer/tickets', {
  headers: { 'X-Buyer-Token': 'e2e-local-buyer-token-2026' },
})

const generatedInvite = await request(
  'Geracao de link pelo botao Preencher',
  'buyer-api',
  '/backend/v1/buyer/tickets/e2e-ticket-platinum/invite?force=true',
  {
    method: 'POST',
    headers: { 'X-Buyer-Token': 'e2e-local-buyer-token-2026' },
    body: '{}',
  },
)
if (typeof generatedInvite.token !== 'string' || generatedInvite.token.length !== 64) {
  throw new Error('Geracao de link pelo botao Preencher: token invalido')
}
const buyerInviteHours = (new Date(generatedInvite.expiresAt).getTime() - Date.now()) / 3_600_000
if (buyerInviteHours < 23 || buyerInviteHours > 25) {
  throw new Error('Geracao de link pelo botao Preencher: validade diferente de 24 horas')
}

const participant = await request(
  'Link do participante',
  'public-api',
  '/backend/v1/participant/link/e2e-local-participant-token-2026',
)
if (
  participant.comprador?.nome !== 'Comprador Local' ||
  participant.comprador?.email !== 'comprador.local@adapta.test' ||
  participant.comprador?.documento !== '12345678900' ||
  participant.comprador?.telefone !== '11999999999'
) {
  throw new Error('Link do participante: dados do comprador incompletos')
}

await request('Login do helpdesk', 'helpdesk-api', '/backend/v1/helpdesk/login', {
  method: 'POST',
  headers: { 'X-Helpdesk-Key': functions.HELPDESK_KEY },
  body: '{}',
})

const auth = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: session, error: signInError } = await auth.auth.signInWithPassword({
  email: 'admin.local@adapta.test',
  password: 'AdminLocal#2026',
})
if (signInError || !session.session) {
  throw new Error(`Login administrativo: ${signInError?.message ?? 'sessao ausente'}`)
}

const stats = await request('Dashboard administrativo', 'admin-api', '/backend/v1/admin/stats', {
  headers: { Authorization: `Bearer ${session.session.access_token}` },
})
const adminHeaders = { Authorization: `Bearer ${session.session.access_token}` }
const adminRequest = (name, path, init = {}) =>
  request(name, 'admin-api', path, {
    ...init,
    headers: { ...adminHeaders, ...init.headers },
  })
const insights = await request(
  'Insights administrativos',
  'admin-api',
  '/backend/v1/admin/insights',
  {
    headers: { Authorization: `Bearer ${session.session.access_token}` },
  },
)
if (!insights.perfil || !insights.ia?.por_tipo || !insights.ferramentas) {
  throw new Error('Insights administrativos: contrato incompleto')
}

const linkRunId = String(Date.now())
const adminTicket = await adminRequest('Ingresso para validade de links', '/backend/v1/admin/tickets', {
  method: 'POST',
  body: JSON.stringify({ comprador_id: 'e2e-buyer', tipo_ingresso: 'GOLD' }),
})
const adminInvite = await adminRequest(
  'Convite administrativo de 30 dias',
  `/backend/v1/admin/ticket/${adminTicket.id}/invite-link`,
  { method: 'POST', body: '{}' },
)
const adminInviteDays = (new Date(adminInvite.expiresAt).getTime() - Date.now()) / 86_400_000
if (adminInviteDays < 29 || adminInviteDays > 31) {
  throw new Error('Convite administrativo: validade diferente de 30 dias')
}
await adminRequest('Credenciamento para link de visualizacao', '/backend/v1/admin/participant/create', {
  method: 'POST',
  body: JSON.stringify({
    ingresso_id: adminTicket.id,
    nome_completo: 'Visualizacao E2E',
    email: `visualizacao.${linkRunId}@adapta.test`,
    cpf: cpfFor(linkRunId),
    telefone: '11966665555',
    tem_empresa: false,
    profissao: 'Teste E2E',
  }),
})
const viewLink = await request(
  'Link de visualizacao de 60 dias',
  'buyer-api',
  `/backend/v1/buyer/tickets/${adminTicket.id}/view-token`,
  {
    method: 'POST',
    headers: { 'X-Buyer-Token': 'e2e-local-buyer-token-2026' },
    body: '{}',
  },
)
const viewDays = (new Date(viewLink.expiresAt).getTime() - Date.now()) / 86_400_000
if (viewDays < 59 || viewDays > 61) {
  throw new Error('Link de visualizacao: validade diferente de 60 dias')
}

const courtesy = await adminRequest(
  'Criacao de cortesia',
  '/backend/v1/admin/cortesias/create',
  {
    method: 'POST',
    body: JSON.stringify({
      anfitriao: 'E2E Local',
      tipo_ingresso: 'GOLD',
      limite: 2,
    }),
  },
)
const courtesyInfo = await request(
  'Consulta publica de cortesia',
  'public-api',
  `/backend/v1/cortesia/info/${courtesy.token}`,
)
if (courtesyInfo.anfitriao !== 'E2E Local' || courtesyInfo.restantes !== 2) {
  throw new Error('Consulta publica de cortesia: contrato incompleto')
}

const importedEmail = `importado.${Date.now()}@adapta.test`
const imported = await adminRequest(
  'Importacao com quatro categorias',
  '/backend/v1/admin/import-buyers',
  {
    method: 'POST',
    body: JSON.stringify({
      rows: [{
        nome: 'Importado E2E',
        email: importedEmail,
        qtd_gold: 1,
        qtd_platinum: 1,
        qtd_palestrantes: 1,
        qtd_hackathon: 1,
      }],
      enviar_email: true,
    }),
  },
)
if (imported.imported !== 4 || imported.email?.queued !== 1) {
  throw new Error(`Importacao: resultado inesperado ${JSON.stringify(imported)}`)
}
const reconciled = await adminRequest(
  'Reconciliacao',
  '/backend/v1/admin/reconciliar-ingressos',
  {
    method: 'POST',
    body: JSON.stringify({
      rows: [{ nome: 'Importado E2E', email: importedEmail, ingressos_esperado: 4 }],
    }),
  },
)
if (reconciled.classificacoes?.ok !== 1) {
  throw new Error(`Reconciliacao: resultado inesperado ${JSON.stringify(reconciled)}`)
}

const emailDispatch = await adminRequest(
  'Fila de e-mail',
  '/backend/v1/admin/dispatch/enqueue',
  {
    method: 'POST',
    body: JSON.stringify({
      cluster: 'individual',
      audience: 'compradores',
      recipient_id: 'e2e-buyer',
      nome: 'E2E e-mail',
      template_id: 'd-local-e2e-template',
      template_nome: 'Template E2E',
    }),
  },
)
const whatsappDispatch = await adminRequest(
  'Fila de WhatsApp',
  '/backend/v1/admin/whatsapp/enqueue',
  {
    method: 'POST',
    body: JSON.stringify({
      cluster: 'individual',
      recipient_id: 'e2e-buyer',
      nome: 'E2E WhatsApp',
      flow: 'PRE',
      mapping: [],
    }),
  },
)
const worker = await request('Worker de filas', 'dispatch-worker', '/', {
  method: 'POST',
  headers: { 'X-Worker-Key': functions.DISPATCH_WORKER_SECRET },
  body: '{}',
})
if (!worker.success || worker.email.sent < 2 || worker.whatsapp.sent < 1) {
  throw new Error(`Worker: resultado inesperado ${JSON.stringify(worker)}`)
}

const runId = String(Date.now())
const apiBuyer = await request(
  'API externa cria comprador',
  'public-api',
  '/backend/v1/external/compradores',
  {
    method: 'POST',
    headers: { 'X-Api-Key': functions.EXTERNAL_API_KEY },
    body: JSON.stringify({
      nome: 'API E2E',
      email: `api.${runId}@adapta.test`,
      documento: '',
      telefone: '11988887777',
      qtd_gold: 1,
    }),
  },
)
if (apiBuyer.ingressos_criados !== 1 || !apiBuyer.ingresso_ids?.[0]) {
  throw new Error(`API externa: criacao inesperada ${JSON.stringify(apiBuyer)}`)
}
if (!apiBuyer.comprador_id || !apiBuyer.ingressos?.[0]?.pedido_id) {
  throw new Error('API externa: contrato legado de criacao incompleto')
}
const apiLookup = await request(
  'API externa busca comprador',
  'public-api',
  `/backend/v1/external/compradores?email=${encodeURIComponent(`api.${runId}@adapta.test`)}`,
  { headers: { 'X-Api-Key': functions.EXTERNAL_API_KEY } },
)
if (apiLookup.compradores?.[0]?.ingressos_disponiveis !== 1) {
  throw new Error('API externa: busca de comprador incompleta')
}
const participantEmail = `participante.api.${runId}@adapta.test`
const apiCredential = await request(
  'API externa credenciamento',
  'public-api',
  '/backend/v1/external/credenciamento',
  {
    method: 'POST',
    headers: { 'X-Api-Key': functions.EXTERNAL_API_KEY },
    body: JSON.stringify({
      ingresso_id: apiBuyer.ingresso_ids[0],
      nome_completo: 'Participante API E2E',
      email: participantEmail,
      cpf: cpfFor(runId),
      telefone: '11977776666',
      tem_empresa: false,
      profissao: 'Teste E2E',
    }),
  },
)
if (apiCredential.inac?.credenciado !== true || !apiCredential.participante_id) {
  throw new Error('API externa: credenciamento incompleto')
}
const participantLookup = await request(
  'API externa busca participante',
  'public-api',
  `/backend/v1/external/participantes?email=${encodeURIComponent(participantEmail)}`,
  { headers: { 'X-Api-Key': functions.EXTERNAL_API_KEY } },
)
if (participantLookup.participantes?.[0]?.ingresso?.id !== apiBuyer.ingresso_ids[0]) {
  throw new Error('API externa: busca de participante incompleta')
}
const buyerResend = await request(
  'API externa reenvia comprador',
  'public-api',
  '/backend/v1/external/reenviar-comprador',
  {
    method: 'POST',
    headers: { 'X-Api-Key': functions.EXTERNAL_API_KEY },
    body: JSON.stringify({ comprador_id: apiBuyer.comprador_id }),
  },
)
const participantResend = await request(
  'API externa reenvia participante',
  'public-api',
  '/backend/v1/external/reenviar-participante',
  {
    method: 'POST',
    headers: { 'X-Api-Key': functions.EXTERNAL_API_KEY },
    body: JSON.stringify({ participante_id: apiCredential.participante_id }),
  },
)
if (!buyerResend.success || !participantResend.success) {
  throw new Error('API externa: reenvio essencial falhou')
}
const guru = await request('Webhook Guru', 'public-api', '/backend/v1/webhooks/guru', {
  method: 'POST',
  body: JSON.stringify({
    id: `guru-e2e-${runId}`,
    status: 'approved',
    contact: { name: 'Guru E2E', email: `guru.${runId}@adapta.test` },
    items: [{ name: 'Adapta Summit GOLD', quantity: 1 }],
  }),
})
const guruDuplicate = await request(
  'Webhook Guru idempotente',
  'public-api',
  '/backend/v1/webhooks/guru',
  {
    method: 'POST',
    body: JSON.stringify({
      id: `guru-e2e-${runId}`,
      status: 'approved',
      contact: { name: 'Guru E2E', email: `guru.${runId}@adapta.test` },
      items: [{ name: 'Adapta Summit GOLD', quantity: 1 }],
    }),
  },
)
if (guru.ingressos !== 1 || guruDuplicate.duplicate !== true) {
  throw new Error('Webhook Guru: deduplicacao falhou')
}
if (guru.email_enfileirado !== true) {
  throw new Error('Webhook Guru: e-mail nao foi enfileirado')
}
const guruWorker = await request('Worker da fila Guru', 'dispatch-worker', '/', {
  method: 'POST',
  headers: { 'X-Worker-Key': functions.DISPATCH_WORKER_SECRET },
  body: '{}',
})
if (guruWorker.email.sent < 1) throw new Error('Worker da fila Guru nao enviou o e-mail')

console.log(
  JSON.stringify(
    {
      buyer: buyer.comprador?.email,
      tickets: tickets.totalItems,
      generatedInvite: 'ok',
      participantTicket: participant.id,
      helpdesk: 'ok',
      admin: 'ok',
      insights: 'ok',
      parity: {
        courtesy: courtesy.id,
        imported: imported.imported,
        emailDispatch: emailDispatch.disparo_id,
        whatsappDispatch: whatsappDispatch.disparo_id,
        externalApi: apiBuyer.ingressos_criados,
        guruIdempotency: 'ok',
        guruQueue: 'ok',
        worker: worker.success,
      },
      stats: {
        compradores: stats.compradores_total,
        ingressos: stats.total,
      },
    },
    null,
    2,
  ),
)

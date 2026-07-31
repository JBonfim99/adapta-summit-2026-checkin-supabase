import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const root = new URL('../', import.meta.url)

async function readEnv(relativePath) {
  try {
    const text = await readFile(new URL(relativePath, root), 'utf8')
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const separator = line.indexOf('=')
          const key = line.slice(0, separator)
          let value = line.slice(separator + 1).trim()
          if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))
          ) {
            value = value.slice(1, -1)
          }
          return [key, value]
        }),
    )
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

function requireValue(values, names) {
  for (const name of names) {
    if (values[name]) return values[name]
  }
  throw new Error(
    `Configuracao local ausente: ${names.join(' ou ')}. Rode "supabase status -o env".`,
  )
}

async function expectSuccess(label, operation) {
  const { error } = await operation
  if (error) throw new Error(`${label}: ${error.message}`)
}

const frontendEnv = await readEnv('.env.local')
const loadEnv = await readEnv('.env.load.local')
const preserveEnvFiles = process.env.E2E_PRESERVE_ENV_FILES === 'true'
const values = preserveEnvFiles
  ? { ...frontendEnv, ...loadEnv, ...process.env }
  : { ...loadEnv, ...frontendEnv, ...process.env }

const supabaseUrl = requireValue(values, ['SUPABASE_URL', 'VITE_SUPABASE_URL'])
const publishableKey = requireValue(values, [
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
])
const serviceRoleKey = requireValue(values, ['SUPABASE_SERVICE_ROLE_KEY'])
const parsedUrl = new URL(supabaseUrl)

if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
  throw new Error(`Recusando preparar E2E fora do Supabase local: ${parsedUrl.hostname}`)
}

const appUrl = 'http://127.0.0.1:4173'
const syncSecret = process.env.E2E_SYNC_HMAC_SECRET ?? 'SyncLocalOnly#2026'
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.local@adapta.test'
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'AdminLocal#2026'
const buyerEmail = 'comprador.local@adapta.test'
const buyerToken = 'e2e-local-buyer-token-2026'
const participantToken = 'e2e-local-participant-token-2026'

if (!preserveEnvFiles) {
  await writeFile(
    new URL('.env.local', root),
    [
      `VITE_SUPABASE_URL=${supabaseUrl}`,
      `VITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
      `VITE_APP_URL=${appUrl}`,
      '',
    ].join('\n'),
    'utf8',
  )

  await writeFile(
    new URL('supabase/.env.local', root),
    [
      `APP_URL=${appUrl}`,
      `SUPABASE_URL=${supabaseUrl}`,
      `SUPABASE_ANON_KEY=${publishableKey}`,
      `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
      `SYNC_HMAC_SECRET=${syncSecret}`,
      'INAC_MODE=mock',
      'SENDGRID_MODE=mock',
      'SENDGRID_FROM_NAME=Adapta Summit 2026',
      'SENDGRID_BUYER_TEMPLATE_ID=d-local-buyer-template',
      'SENDGRID_IMPORT_TEMPLATE_ID=d-local-import-template',
      'SENDGRID_IMPORT_TEMPLATE_NAME=Importacao local',
      'BOTCONVERSA_MODE=mock',
      'EXTERNAL_API_KEY=ExternalLocal#2026',
      'DISPATCH_WORKER_SECRET=WorkerLocal#2026',
      'ALLOW_STANDBY_WRITES=true',
      '',
    ].join('\n'),
    'utf8',
  )
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
})
if (usersError) throw new Error(`Listar usuarios locais: ${usersError.message}`)

let adminUser = usersPage.users.find((user) => user.email === adminEmail)
if (adminUser) {
  const { data, error } = await admin.auth.admin.updateUserById(adminUser.id, {
    password: adminPassword,
    email_confirm: true,
  })
  if (error) throw new Error(`Atualizar admin local: ${error.message}`)
  adminUser = data.user
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`Criar admin local: ${error?.message}`)
  adminUser = data.user
}

await expectSuccess(
  'Perfil administrativo',
  admin.from('admin_profiles').upsert(
    {
      user_id: adminUser.id,
      display_name: 'Administrador Local',
      role: 'admin',
      active: true,
    },
    { onConflict: 'user_id' },
  ),
)

await expectSuccess(
  'Comprador E2E',
  admin.from('compradores').upsert(
    {
      id: 'e2e-buyer',
      nome: 'Comprador Local',
      email: buyerEmail,
      documento: '12345678900',
      uf: 'SP',
      cidade: 'Sao Paulo',
      telefone: '11999999999',
    },
    { onConflict: 'id' },
  ),
)

await expectSuccess(
  'Ingressos E2E',
  admin.from('ingressos').upsert(
    [
      {
        id: 'e2e-ticket-gold',
        comprador_id: 'e2e-buyer',
        pedido_id: 'PEDIDO-E2E-GOLD',
        tipo_ingresso: 'GOLD',
        status: 'Pendente',
        origem: 'local-e2e',
      },
      {
        id: 'e2e-ticket-platinum',
        comprador_id: 'e2e-buyer',
        pedido_id: 'PEDIDO-E2E-PLATINUM',
        tipo_ingresso: 'PLATINUM',
        status: 'Pendente',
        origem: 'local-e2e',
      },
    ],
    { onConflict: 'id' },
  ),
)

await expectSuccess(
  'Token do comprador',
  admin.from('tokens_acesso').upsert(
    {
      id: 'e2e-buyer-token',
      comprador_id: 'e2e-buyer',
      token: buyerToken,
      usado: false,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'id' },
  ),
)

await expectSuccess(
  'Link do participante',
  admin.from('links_participante').upsert(
    {
      id: 'e2e-participant-link',
      ingresso_id: 'e2e-ticket-gold',
      token: participantToken,
      usado: false,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'id' },
  ),
)

console.log(
  JSON.stringify(
    {
      app: appUrl,
      buyer: {
        email: buyerEmail,
        accessUrl: `${appUrl}/acesso?token=${buyerToken}`,
        participantUrl: `${appUrl}/participante?token=${participantToken}`,
      },
      helpdesk: {
        url: `${appUrl}/helpdesk`,
        operator: 'Teste Local',
        password: helpdeskKey,
      },
      admin: {
        url: `${appUrl}/admin/login`,
        email: adminEmail,
        password: adminPassword,
      },
      integrations: {
        inac: 'mock',
        sendgrid: 'mock',
        botconversa: 'mock',
        externalApiKey: 'ExternalLocal#2026',
        dispatchWorkerKey: 'WorkerLocal#2026',
      },
    },
    null,
    2,
  ),
)

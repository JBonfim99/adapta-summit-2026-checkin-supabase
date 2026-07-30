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
        let value = line.slice(separator + 1).trim()
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1)
        }
        return [line.slice(0, separator), value]
      }),
  )
}

function required(values, name) {
  const value = values[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const frontend = await parseEnv('.env.local')
const remote = await parseEnv('supabase/.env.remote.local')
const supabaseUrl = required(frontend, 'VITE_SUPABASE_URL').replace(/\/$/, '')
const publishableKey = required(frontend, 'VITE_SUPABASE_PUBLISHABLE_KEY')
const project = new URL(supabaseUrl).hostname.split('.')[0]

if (project !== 'idiagqbfmvyoywyjfufe') {
  throw new Error(`Refusing rollout verification for unexpected project: ${project}`)
}

async function functionRequest(functionName, path, init = {}) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${functionName}${path}: HTTP ${response.status} ${JSON.stringify(data)}`)
  }
  return data
}

const auth = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: session, error: signInError } = await auth.auth.signInWithPassword({
  email: required(remote, 'ADMIN_EMAIL'),
  password: required(remote, 'ADMIN_PASSWORD'),
})
if (signInError || !session.session) {
  throw new Error(`admin login: ${signInError?.message ?? 'session missing'}`)
}

const failover = await functionRequest('admin-api', '/backend/v1/admin/system/failover', {
  headers: { Authorization: `Bearer ${session.session.access_token}` },
})
if (failover.health?.mode !== 'standby') throw new Error('Supabase is not in standby')
if (failover.health?.external_effects_enabled !== false) {
  throw new Error('External effects are unexpectedly enabled')
}
if (failover.worker?.paused !== true) throw new Error('Dispatch worker is not reported as paused')
for (const [provider, mode] of Object.entries(failover.provider_modes ?? {})) {
  if (mode !== 'mock') throw new Error(`${provider} is not in mock mode`)
}

const worker = await functionRequest('dispatch-worker', '', {
  method: 'POST',
  headers: { 'X-Worker-Key': required(remote, 'DISPATCH_WORKER_SECRET') },
  body: '{}',
})
if (worker.paused !== true || worker.email?.claimed !== 0 || worker.whatsapp?.claimed !== 0) {
  throw new Error(`Dispatch worker gate failed: ${JSON.stringify(worker)}`)
}

const sync = await functionRequest('sync-pull', '', {
  method: 'POST',
  headers: { 'X-Worker-Key': required(remote, 'DISPATCH_WORKER_SECRET') },
  body: JSON.stringify({ action: 'status' }),
})
if (sync.state?.mode !== 'standby' || sync.state?.external_effects_enabled !== false) {
  throw new Error(`Sync status safety state failed: ${JSON.stringify(sync.state)}`)
}

const state = failover.health
if (
  state.mode !== 'standby' ||
  state.external_effects_enabled !== false ||
  state.pocketbase_writes_blocked !== false
) {
  throw new Error(`Unsafe system_state: ${JSON.stringify(state)}`)
}

console.log(
  JSON.stringify(
    {
      project,
      mode: state.mode,
      externalEffects: state.external_effects_enabled,
      providers: failover.provider_modes,
      workerPaused: worker.paused,
      bootstrap: state.bootstrap_state,
      backlog: state.sync_outbox_backlog,
      syncError: state.last_sync_error,
    },
    null,
    2,
  ),
)

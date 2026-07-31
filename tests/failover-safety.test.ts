import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('failover external-effects gate', () => {
  it('never sends a write-control command to the Skip application', () => {
    const adminApi = source('supabase/functions/admin-api/index.ts')
    const skipSync = source('supabase/functions/_shared/skip-sync.ts')
    expect(adminApi).not.toContain('setSkipWriteBlock')
    expect(skipSync).not.toContain('/backend/v1/sync/control')
  })

  it.each([
    'supabase/functions/_shared/sendgrid.ts',
    'supabase/functions/_shared/botconversa.ts',
    'supabase/functions/_shared/inac.ts',
  ])('guards %s before provider behavior', (path) => {
    const provider = source(path)
    expect(provider.indexOf('requireExternalEffectsEnabled(db)')).toBeGreaterThan(-1)
    expect(provider.indexOf('requireExternalEffectsEnabled(db)')).toBeLessThan(
      provider.indexOf('await auditIntegration'),
    )
  })

  it('does not let ALLOW_STANDBY_WRITES bypass the external-effects gate', () => {
    const operations = source('supabase/functions/_shared/operations.ts')
    const gate = operations.slice(operations.indexOf('requireExternalEffectsEnabled'))
    expect(gate).not.toContain('ALLOW_STANDBY_WRITES')
    expect(gate).toContain("data.mode !== 'active'")
    expect(gate).toContain('data.external_effects_enabled !== true')
  })

  it('checks the gate before the dispatch worker claims queues', () => {
    const worker = source('supabase/functions/dispatch-worker/index.ts')
    expect(worker.indexOf('await requireExternalEffectsEnabled()')).toBeLessThan(
      worker.indexOf('Promise.all([processEmailBatch()'),
    )
    expect(worker.match(/message === 'EXTERNAL_EFFECTS_DISABLED'/g)?.length).toBeGreaterThanOrEqual(
      3,
    )
  })

  it.each(['create', 'update', 'delete'])(
    'writes %s events through a pre-commit Skip model hook',
    (operation) => {
      const hook = source(`integrations/pocketbase-primary/hooks/sync_outbox_${operation}.js`)
      expect(hook).toContain(`onRecord${operation[0].toUpperCase()}${operation.slice(1)}(`)
      expect(hook).not.toContain('After')
      expect(hook).not.toContain('pending_count')
    },
  )

  it('keeps the empty Skip poll to indexed outbox reads', () => {
    const hook = source('integrations/pocketbase-primary/hooks/sync_outbox_list.js')
    expect(hook).toContain(`state = 'pending'`)
    expect(hook).toContain(`source_table = 'compradores'`)
    expect(hook).toContain(`source_table = 'ingressos'`)
    expect(hook).toContain(`source_table = 'participantes'`)
    expect(hook).toContain(`'created,id'`)
  })

  it('retires only outbox events already represented by a completed bootstrap snapshot', () => {
    const hook = source(
      'integrations/pocketbase-primary/hooks/sync_outbox_ack_through.js',
    )
    expect(hook).toContain(`'/backend/v1/sync/outbox/ack-through'`)
    expect(hook).toContain(`cursorRecord.getString('created') !== created`)
    expect(hook).toContain(`created < {:created}`)
    expect(hook).toContain(`created = {:created} AND id <= {:id}`)
    expect(hook).toContain(`state = 'delivered'`)
    expect(hook).not.toMatch(/DELETE FROM sync_outbox/i)

    const edgeFunction = source('supabase/functions/sync-pull/index.ts')
    expect(edgeFunction).toContain('await retireOutboxThrough')
    expect(edgeFunction).toContain('await recordPoll(retired.backlog)')
  })

  it('limits Skip snapshots and lifecycle outbox hooks to the participant core', () => {
    const core = ['compradores', 'ingressos', 'participantes']
    const excluded = [
      'tokens_acesso',
      'links_participante',
      'webhooks_log',
      'disparos',
      'envios',
      'pedidos_guru',
      'disparos_wa',
      'cortesias',
    ]
    const paths = [
      'integrations/pocketbase-primary/hooks/sync_snapshot.js',
      'integrations/pocketbase-primary/hooks/sync_outbox_create.js',
      'integrations/pocketbase-primary/hooks/sync_outbox_update.js',
      'integrations/pocketbase-primary/hooks/sync_outbox_delete.js',
    ]

    for (const path of paths) {
      const hook = source(path)
      for (const collection of core) expect(hook).toContain(`'${collection}'`)
      for (const collection of excluded) expect(hook).not.toContain(`'${collection}'`)
    }
  })

  it('limits Supabase pull and Skip backlog reporting to the same three collections', () => {
    const edgeFunction = source('supabase/functions/sync-pull/index.ts')
    const collectionBlock = edgeFunction.slice(
      edgeFunction.indexOf('const collections = ['),
      edgeFunction.indexOf('] as const') + '] as const'.length,
    )
    expect(collectionBlock).toContain(`'compradores'`)
    expect(collectionBlock).toContain(`'ingressos'`)
    expect(collectionBlock).toContain(`'participantes'`)
    expect(collectionBlock).not.toContain(`'tokens_acesso'`)
    expect(collectionBlock).not.toContain(`'envios'`)

    for (const path of [
      'integrations/pocketbase-primary/hooks/sync_outbox_list.js',
      'integrations/pocketbase-primary/hooks/sync_status.js',
    ]) {
      const hook = source(path)
      expect(hook).toContain(`source_table = 'compradores'`)
      expect(hook).toContain(`source_table = 'ingressos'`)
      expect(hook).toContain(`source_table = 'participantes'`)
      expect(hook).not.toContain(`source_table = 'tokens_acesso'`)
      expect(hook).not.toContain(`source_table = 'envios'`)
    }

    const status = source('integrations/pocketbase-primary/hooks/sync_status.js')
    expect(status).toContain(`findRecordsByFilter(`)
    expect(status).not.toContain(`findFirstRecordByFilter('sync_outbox'`)
    expect(status).toContain(`$dbx.in('source_table', 'compradores', 'ingressos', 'participantes')`)
    expect(status).toContain(`countRecords('sync_outbox', pendingCoreExpression)`)

    const outbox = source('integrations/pocketbase-primary/hooks/sync_outbox_list.js')
    expect(outbox).toContain(
      `$dbx.in('source_table', 'compradores', 'ingressos', 'participantes')`,
    )
    expect(outbox).toContain(`countRecords('sync_outbox', pendingCoreExpression)`)
  })

  it('retires pending events from the eight excluded collections without touching business rows', () => {
    const migration = source(
      'integrations/pocketbase-primary/migrations/0046_reduce_supabase_sync_scope.js',
    )
    expect(migration).toContain(`source_table != 'compradores'`)
    expect(migration).toContain(`source_table != 'ingressos'`)
    expect(migration).toContain(`source_table != 'participantes'`)
    expect(migration).toContain(`set('state', 'delivered')`)
    expect(migration).not.toMatch(/delete|remove/i)
  })

  it('allows authenticated Skip dashboard admins to trigger bootstrap or pull-now', () => {
    const hook = source('integrations/pocketbase-primary/hooks/sync_trigger.js')
    expect(hook).toContain('$apis.requireAuth()')
    expect(hook).not.toContain('$apis.requireSuperuserAuth()')
    expect(hook).toContain('$apis.bodyLimit(8192)')
  })

  it('gates provider catalog reads when they are not mocked', () => {
    const adminDispatch = source('supabase/functions/_shared/admin-dispatch-parity.ts')
    const firstProviderFetch = adminDispatch.indexOf("fetch(\n      'https://api.sendgrid.com")
    expect(firstProviderFetch).toBeGreaterThan(-1)
    expect(adminDispatch.indexOf('await requireExternalEffectsEnabled()')).toBeLessThan(
      firstProviderFetch,
    )

    const bot = source('supabase/functions/_shared/botconversa.ts')
    expect(bot.indexOf('await requireExternalEffectsEnabled()')).toBeLessThan(
      bot.indexOf("return botRequest('/flows/')"),
    )
  })
})

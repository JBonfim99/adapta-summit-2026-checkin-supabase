import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('failover external-effects gate', () => {
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
    expect(hook).toContain(`"state = 'pending'"`)
    expect(hook).toContain(`'created,id'`)
  })

  it('allows only Skip superusers to trigger bootstrap or pull-now', () => {
    const hook = source('integrations/pocketbase-primary/hooks/sync_trigger.js')
    expect(hook).toContain('$apis.requireSuperuserAuth()')
    expect(hook).not.toContain('$apis.requireAuth()')
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

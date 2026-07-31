import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('helpdesk operator identification', () => {
  it('stores only the operator name and sends no shared key', () => {
    const client = source('src/lib/helpdesk.ts')
    expect(client).toContain("const OP_STORAGE = 'helpdesk_operador'")
    expect(client).not.toContain('helpdesk_key')
    expect(client).not.toContain('X-Helpdesk-Key')
  })

  it('does not require a shared credential or login endpoint server-side', () => {
    const api = source('supabase/functions/helpdesk-api/index.ts')
    expect(api).not.toContain('requireHelpdesk')
    expect(api).not.toContain('/backend/v1/helpdesk/login')
  })
})

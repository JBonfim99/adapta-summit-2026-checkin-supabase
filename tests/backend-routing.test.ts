import { describe, expect, it } from 'vitest'
import { functionNameForPath } from '../src/lib/backend/routing'

describe('backend route ownership', () => {
  it.each([
    ['/backend/v1/auth/magic-link', 'public-api'],
    ['/backend/v1/participant/submit', 'public-api'],
    ['/backend/v1/buyer/tickets', 'buyer-api'],
    ['/backend/v1/helpdesk/search', 'helpdesk-api'],
    ['/backend/v1/admin/stats', 'admin-api'],
  ])('maps %s to %s', (path, functionName) => {
    expect(functionNameForPath(path)).toBe(functionName)
  })
})

import { describe, expect, it } from 'vitest'
import { functionNameForPath } from '../src/lib/backend/routing'
import { routeContracts } from '../scripts/route-contracts.mjs'

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

  it('maps every route in the 65-contract matrix to its Edge Function', () => {
    expect(routeContracts).toHaveLength(65)
    for (const contract of routeContracts) {
      const concretePath = contract.path.replace(/\{[^}]+\}/g, 'contract-fixture')
      expect(functionNameForPath(concretePath)).toBe(contract.owner)
      expect(contract.auth).toBeTruthy()
      expect(contract.effect).toBeTruthy()
      expect(contract.assertion).toBeTruthy()
    }
  })
})

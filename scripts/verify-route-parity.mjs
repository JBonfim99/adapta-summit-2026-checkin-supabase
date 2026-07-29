import { readFile } from 'node:fs/promises'
import { routeContracts } from './route-contracts.mjs'

const ownerFiles = {
  'admin-api': [
    'supabase/functions/admin-api/index.ts',
    'supabase/functions/_shared/admin-data-parity.ts',
    'supabase/functions/_shared/admin-dispatch-parity.ts',
  ],
  'buyer-api': ['supabase/functions/buyer-api/index.ts'],
  'helpdesk-api': ['supabase/functions/helpdesk-api/index.ts', 'supabase/schemas/06_parity.sql'],
  'public-api': [
    'supabase/functions/public-api/index.ts',
    'supabase/functions/_shared/public-parity.ts',
  ],
}

if (routeContracts.length !== 65) {
  throw new Error(`Expected 65 contracts, found ${routeContracts.length}`)
}

const keys = routeContracts.map((contract) => `${contract.method} ${contract.path}`)
if (new Set(keys).size !== keys.length) throw new Error('Duplicate route contracts found')

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(ownerFiles).map(async ([owner, files]) => [
      owner,
      (await Promise.all(files.map((file) => readFile(file, 'utf8'))))
        .join('\n')
        .replaceAll('\\/', '/'),
    ]),
  ),
)

const failures = []
for (const contract of routeContracts) {
  const source = sources[contract.owner]
  if (!source) {
    failures.push(`${contract.method} ${contract.path}: unknown owner ${contract.owner}`)
    continue
  }
  for (const field of ['auth', 'implementation', 'effect', 'assertion']) {
    if (!String(contract[field] ?? '').trim()) {
      failures.push(`${contract.method} ${contract.path}: missing ${field}`)
    }
  }
  const staticSegments = contract.path.split(/\{[^}]+\}/).filter((segment) => segment.length >= 5)
  if (staticSegments.some((segment) => !source.includes(segment))) {
    failures.push(`${contract.method} ${contract.path}: handler path not represented`)
  }
  if (!source.includes(contract.implementation)) {
    failures.push(
      `${contract.method} ${contract.path}: implementation ${contract.implementation} missing`,
    )
  }
  if (
    /stub|not[_ -]?implemented|todo/i.test(contract.implementation) ||
    /stub|not[_ -]?implemented|todo/i.test(contract.assertion)
  ) {
    failures.push(`${contract.method} ${contract.path}: contract points to a stub`)
  }
  if (contract.method !== 'GET' && contract.effect === 'read') {
    failures.push(`${contract.method} ${contract.path}: mutation has no declared effect`)
  }
}

const allSources = Object.values(sources).join('\n')
if (allSources.includes('/backend/v1/admin/resend')) {
  failures.push('Deprecated /backend/v1/admin/resend route is still present')
}

if (failures.length > 0) {
  throw new Error(`Route contract failures:\n${failures.join('\n')}`)
}

const authModes = [...new Set(routeContracts.map((contract) => contract.auth))].sort()
console.log(
  `Route contract matrix: ${routeContracts.length}/65 routes with implementation, auth, effect and assertion (${authModes.join(', ')}).`,
)

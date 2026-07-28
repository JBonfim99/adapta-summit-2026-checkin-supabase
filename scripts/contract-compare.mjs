const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value.replace(/\/$/, '')
}

const primary = required('POCKETBASE_PUBLIC_URL')
const fallback = required('SUPABASE_FUNCTIONS_URL')
const publishableKey = required('SUPABASE_PUBLISHABLE_KEY')

const cases = [
  {
    name: 'invalid buyer token',
    method: 'GET',
    path: '/backend/v1/buyer/tickets',
    headers: { Authorization: 'Bearer invalid-contract-token' },
  },
  {
    name: 'invalid participant link',
    method: 'GET',
    path: '/backend/v1/participant/link/invalid-contract-token',
  },
  {
    name: 'invalid participant ticket',
    method: 'GET',
    path: '/backend/v1/participant/ticket/invalid-contract-token',
  },
  {
    name: 'invalid email availability payload',
    method: 'POST',
    path: '/backend/v1/participant/email-check',
    body: { email: 'contract-unused@example.com' },
  },
]

const functionName = (path) => {
  if (path.startsWith('/backend/v1/buyer/')) return 'buyer-api'
  if (path.startsWith('/backend/v1/helpdesk/')) return 'helpdesk-api'
  if (path.startsWith('/backend/v1/admin/')) return 'admin-api'
  return 'public-api'
}

async function request(base, test, isFallback) {
  const url = isFallback
    ? `${base}/${functionName(test.path)}${test.path}`
    : `${base}${test.path}`
  const response = await fetch(url, {
    method: test.method,
    headers: {
      'Content-Type': 'application/json',
      ...(isFallback ? { apikey: publishableKey } : {}),
      ...(test.headers ?? {}),
    },
    body: test.body ? JSON.stringify(test.body) : undefined,
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  return { status: response.status, payload }
}

const normalize = (result) => ({
  statusClass: Math.floor(result.status / 100),
  success: result.status >= 200 && result.status < 300,
  available:
    result.payload && typeof result.payload.available === 'boolean'
      ? result.payload.available
      : undefined,
})

let failures = 0
for (const test of cases) {
  const [source, target] = await Promise.all([
    request(primary, test, false),
    request(fallback, test, true),
  ])
  const sourceContract = normalize(source)
  const targetContract = normalize(target)
  const equal = JSON.stringify(sourceContract) === JSON.stringify(targetContract)
  console.log(`${equal ? 'PASS' : 'FAIL'} ${test.name}`, {
    source: sourceContract,
    target: targetContract,
  })
  if (!equal) failures += 1
}

if (failures > 0) process.exitCode = 1

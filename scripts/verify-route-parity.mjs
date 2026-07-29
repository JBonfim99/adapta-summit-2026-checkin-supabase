import { readFile } from 'node:fs/promises'

const contracts = `
GET /backend/v1/admin/cortesias
GET /backend/v1/admin/cortesias/{id}/registros
GET /backend/v1/admin/insights
GET /backend/v1/admin/logs
GET /backend/v1/admin/participants/search
GET /backend/v1/admin/sendgrid/templates
GET /backend/v1/admin/sendgrid/templates/{id}/preview
GET /backend/v1/admin/stats
GET /backend/v1/admin/whatsapp/custom-fields
GET /backend/v1/admin/whatsapp/flows
GET /backend/v1/buyer/tickets
GET /backend/v1/cortesia/info/{token}
GET /backend/v1/dispatch/health
GET /backend/v1/external/compradores
GET /backend/v1/external/participantes
GET /backend/v1/helpdesk/search
GET /backend/v1/helpdesk/ticket/{id}/qr
GET /backend/v1/participant/link/{token}
GET /backend/v1/participant/ticket/{token}
POST /backend/v1/admin/buyers/{buyerId}/access-link
POST /backend/v1/admin/buyers/{id}/delete
POST /backend/v1/admin/cortesias/{id}/toggle
POST /backend/v1/admin/cortesias/create
POST /backend/v1/admin/dispatch/{disparoId}/retry
POST /backend/v1/admin/dispatch/enqueue
POST /backend/v1/admin/dispatch/preview
POST /backend/v1/admin/dispatch/search-recipient
POST /backend/v1/admin/import-buyers
POST /backend/v1/admin/participant/create
POST /backend/v1/admin/reconciliar-criar-compradores
POST /backend/v1/admin/reconciliar-ingressos
POST /backend/v1/admin/retry-webhook/{ingressoId}
POST /backend/v1/admin/retry-webhook-all
POST /backend/v1/admin/sync-inac-upgrades
POST /backend/v1/admin/ticket/{ingressoId}/invite-link
POST /backend/v1/admin/tickets
POST /backend/v1/admin/tickets/{id}/change-type
POST /backend/v1/admin/tickets/{id}/delete
POST /backend/v1/admin/tickets/{id}/edit
POST /backend/v1/admin/whatsapp/{disparoId}/retry
POST /backend/v1/admin/whatsapp/enqueue
POST /backend/v1/admin/whatsapp/preview
POST /backend/v1/admin/whatsapp/send-individual
POST /backend/v1/auth/magic-link
POST /backend/v1/auth/magic-link/consume
POST /backend/v1/buyer/tickets/{id}/invite
POST /backend/v1/buyer/tickets/{id}/view-token
POST /backend/v1/client-error
POST /backend/v1/cortesia/registrar
POST /backend/v1/external/compradores
POST /backend/v1/external/credenciamento
POST /backend/v1/external/reenviar-comprador
POST /backend/v1/external/reenviar-participante
POST /backend/v1/helpdesk/comprador/{id}/reenviar
POST /backend/v1/helpdesk/credenciar
POST /backend/v1/helpdesk/login
POST /backend/v1/helpdesk/novo-credenciamento
POST /backend/v1/helpdesk/ticket/{id}/editar
POST /backend/v1/helpdesk/ticket/{id}/gerar-qr
POST /backend/v1/helpdesk/ticket/{id}/reenviar
POST /backend/v1/helpdesk/ticket/{id}/tipo
POST /backend/v1/participant/cpf-check
POST /backend/v1/participant/email-check
POST /backend/v1/participant/submit
POST /backend/v1/webhooks/guru
`
  .trim()
  .split('\n')

const files = [
  'supabase/functions/admin-api/index.ts',
  'supabase/functions/buyer-api/index.ts',
  'supabase/functions/helpdesk-api/index.ts',
  'supabase/functions/public-api/index.ts',
  'supabase/functions/_shared/admin-data-parity.ts',
  'supabase/functions/_shared/admin-dispatch-parity.ts',
  'supabase/functions/_shared/public-parity.ts',
]
const source = (
  await Promise.all(files.map((file) => readFile(file, 'utf8')))
)
  .join('\n')
  .replaceAll('\\/', '/')

if (contracts.length !== 65) throw new Error(`Expected 65 contracts, found ${contracts.length}`)

const missing = contracts.filter((contract) => {
  const [method, path] = contract.split(' ')
  const staticSegments = path.split(/\{[^}]+\}/).filter((segment) => segment.length >= 5)
  return !source.includes(`'${method}'`) || staticSegments.some((segment) => !source.includes(segment))
})

if (missing.length > 0) {
  throw new Error(`Missing route implementations:\n${missing.join('\n')}`)
}

console.log(`Route parity: ${contracts.length}/65 contracts represented.`)

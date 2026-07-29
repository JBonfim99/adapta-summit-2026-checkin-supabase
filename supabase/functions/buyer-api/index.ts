import { adminDb, buyerToken, rpc } from '../_shared/db.ts'
import { ApiError, handler, json, routePath } from '../_shared/http.ts'
import {
  createParticipantViewToken,
  requireOperationalWrite,
} from '../_shared/operations.ts'

async function tickets(req: Request) {
  const token = buyerToken(req)
  const result = await rpc<{
    buyer: { id: string; nome: string; email: string }
    tickets: Array<Record<string, unknown>>
  }>('get_buyer_tickets', { p_token: token })

  const items = result.tickets.map((ticket) => ({
    ...ticket,
    pending_link: ticket.pendingLink,
    expand: ticket.participante_id
      ? {
          participante_id: {
            id: ticket.participante_id,
            nome_completo: ticket.participantName,
            email: ticket.participantEmail,
            cpf: ticket.participantCpf,
          },
          comprador_id: result.buyer,
        }
      : { comprador_id: result.buyer },
  }))
  return json({ page: 1, perPage: items.length, totalItems: items.length, items })
}

async function invite(req: Request, ticketId: string) {
  const token = buyerToken(req)
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  const db = adminDb()
  await requireOperationalWrite(db)

  if (force) {
    const buyer = await rpc<{ id: string }>('consume_buyer_token', { p_token: token })
    const { data: ticket } = await db
      .from('ingressos')
      .select('id,comprador_id,status')
      .eq('id', ticketId)
      .eq('comprador_id', buyer.id)
      .maybeSingle()
    if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND')
    if (ticket.status !== 'Pendente') throw new ApiError(409, 'TICKET_ALREADY_CREDENTIALLED')
    await db
      .from('links_participante')
      .update({ usado: true })
      .eq('ingresso_id', ticketId)
      .eq('usado', false)
  }

  const result = await rpc<Record<string, unknown>>('create_participant_link', {
    p_buyer_token: token,
    p_ticket_id: ticketId,
    p_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
  return json(result)
}

async function viewToken(req: Request, ticketId: string) {
  const token = buyerToken(req)
  const buyer = await rpc<{ id: string }>('consume_buyer_token', { p_token: token })
  const db = adminDb()
  const { data: ticket } = await db
    .from('ingressos')
    .select('id,comprador_id,participante_id')
    .eq('id', ticketId)
    .eq('comprador_id', buyer.id)
    .maybeSingle()
  if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND')
  if (!ticket.participante_id) throw new ApiError(409, 'TICKET_NOT_CREDENTIALLED')

  await requireOperationalWrite(db)
  return json(await createParticipantViewToken(db, ticketId))
}

Deno.serve((req) =>
  handler(req, async () => {
    const path = routePath(req, 'buyer-api')
    if (req.method === 'GET' && path === '/backend/v1/buyer/tickets') {
      return tickets(req)
    }

    const inviteMatch = path.match(/^\/backend\/v1\/buyer\/tickets\/([^/]+)\/invite$/)
    if (req.method === 'POST' && inviteMatch) {
      return invite(req, decodeURIComponent(inviteMatch[1]))
    }

    const viewMatch = path.match(/^\/backend\/v1\/buyer\/tickets\/([^/]+)\/view-token$/)
    if (req.method === 'POST' && viewMatch) {
      return viewToken(req, decodeURIComponent(viewMatch[1]))
    }

    throw new ApiError(404, 'ROUTE_NOT_FOUND')
  }),
)

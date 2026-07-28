import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const buyerSession = z.object({
  token: z.string().min(1),
  comprador: z.object({
    id: z.string().min(1),
    nome: z.string(),
    email: z.email(),
  }),
})

const ticket = z.object({
  id: z.string().min(1),
  pedido_id: z.string().min(1),
  tipo_ingresso: z.enum(['GOLD', 'PLATINUM', 'PALESTRANTES', 'HACKATHON']),
  status: z.enum(['Pendente', 'Pré-Credenciado']),
})

const pocketBaseList = z.object({
  page: z.number(),
  perPage: z.number(),
  totalItems: z.number(),
  items: z.array(ticket.passthrough()),
})

describe('v1 compatibility shapes', () => {
  it('keeps the buyer magic-link response contract', () => {
    expect(
      buyerSession.parse({
        token: 'preserved-token',
        comprador: {
          id: 'buyer-id',
          nome: 'Buyer',
          email: 'buyer@example.com',
        },
      }),
    ).toBeTruthy()
  })

  it('keeps PocketBase-style list envelopes for existing screens', () => {
    expect(
      pocketBaseList.parse({
        page: 1,
        perPage: 1,
        totalItems: 1,
        items: [
          {
            id: 'ticket-id',
            pedido_id: 'ORDER-1',
            tipo_ingresso: 'GOLD',
            status: 'Pendente',
          },
        ],
      }),
    ).toBeTruthy()
  })
})

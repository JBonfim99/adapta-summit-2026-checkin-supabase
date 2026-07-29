import { describe, expect, it } from 'vitest'
import {
  inacEndpoint,
  inacHttpMethod,
  makeInacPayload,
} from '../supabase/functions/_shared/inac-contract'
import {
  guruBuyer,
  guruItems,
  guruTransactionId,
} from '../supabase/functions/_shared/guru-contract'

const ticket = {
  id: 'ticket-contract',
  pedido_id: '123456',
  tipo_ingresso: 'GOLD',
  inac_id: '987',
}

const participant = {
  id: 'participant-contract',
  nome_completo: 'Pessoa Contrato',
  email: 'PESSOA@EXAMPLE.COM',
  cpf: '529.982.247-25',
  telefone: '(11) 99999-8888',
  profissao: 'Engenharia',
}

describe('INAC provider contract', () => {
  it.each([
    ['add', 'POST', '/attendees/add'],
    ['edit', 'PUT', '/attendees/edit'],
    ['delete', 'DELETE', '/attendees/delete'],
  ] as const)('uses %s with the correct method and endpoint', (operation, method, suffix) => {
    expect(inacHttpMethod(operation)).toBe(method)
    expect(inacEndpoint('https://inac.test/apiservicev1/attendees/add', operation)).toBe(
      `https://inac.test/apiservicev1${suffix}`,
    )
  })

  it('builds the original attendee fields and category payload', () => {
    const payload = makeInacPayload('edit', ticket, participant, {
      tipo_ingresso: 'PLATINUM',
    }) as any
    expect(payload).toMatchObject({
      id: 987,
      event_id: 375,
      category_id: 6125,
      status: 'active',
    })
    expect(payload.fields).toEqual([
      { id: 10133653, value: 'Pessoa Contrato' },
      { id: 10133654, value: 'pessoa@example.com' },
      { id: 10133655, value: '52998224725' },
      { id: 10133656, value: '5511999998888' },
      { id: 10133657, value: 'Engenharia' },
      { id: 10133665, value: '123456' },
    ])
  })

  it('sends only attendee id and event id on delete', () => {
    expect(makeInacPayload('delete', ticket, participant)).toEqual({
      id: 987,
      event_id: 375,
    })
  })
})

describe('Guru provider contract', () => {
  it('uses marketplace_id, Summit item names and qty', () => {
    const payload = {
      id: 'unstable-event-id',
      payment: { marketplace_id: 'stable-payment-id' },
      items: [
        { name: 'Adapta Summit Gold', qty: 2 },
        { name: 'Adapta Summit Platinum', qty: 1 },
        { name: 'Curso Gold', qty: 9 },
      ],
    }
    expect(guruTransactionId(payload)).toBe('stable-payment-id')
    expect(guruItems(payload)).toEqual([
      { type: 'GOLD', quantity: 2 },
      { type: 'PLATINUM', quantity: 1 },
    ])
  })

  it('maps Guru contact fields without relying on nested aliases', () => {
    expect(
      guruBuyer({
        contact: {
          name: 'Comprador Guru',
          email: ' GURU@EXAMPLE.COM ',
          doc: '123.456.789-00',
          address_state: 'SP',
          address_city: 'São Paulo',
          phone_local_code: '11',
          phone_number: '988887777',
        },
      }),
    ).toEqual({
      nome: 'Comprador Guru',
      email: 'guru@example.com',
      documento: '12345678900',
      uf: 'SP',
      cidade: 'São Paulo',
      telefone: '11988887777',
    })
  })
})

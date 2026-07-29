import { describe, expect, it } from 'vitest'
import {
  canPrefillBuyerIdentity,
  formatCpf,
  formatPhone,
  participantBuyerPrefill,
} from './participant-prefill'

describe('participant buyer prefill', () => {
  it('formats all buyer fields for the participant form', () => {
    expect(
      participantBuyerPrefill({
        nome: 'Comprador Teste',
        email: 'comprador@example.com',
        documento: '12345678900',
        telefone: '11987654321',
      }),
    ).toEqual({
      nome_completo: 'Comprador Teste',
      email: 'comprador@example.com',
      cpf: '123.456.789-00',
      telefone: '(11) 98765-4321',
    })
  })

  it('uses legacy URL values only when buyer identity is absent', () => {
    expect(
      participantBuyerPrefill(null, { nome: 'Comprador', email: 'buyer@example.com' }),
    ).toEqual({
      nome_completo: 'Comprador',
      email: 'buyer@example.com',
      cpf: '',
      telefone: '',
    })
  })

  it('limits masks to their supported digit counts', () => {
    expect(formatCpf('12345678900123')).toBe('123.456.789-00')
    expect(formatPhone('55119999999999')).toBe('(55) 11999-9999')
  })

  it('only allows buyer data for the buyer own fill flow', () => {
    expect(canPrefillBuyerIdentity('buyer', 'buyer-id', 'buyer-id')).toBe(true)
    expect(canPrefillBuyerIdentity(null, 'buyer-id', 'buyer-id')).toBe(false)
    expect(canPrefillBuyerIdentity('buyer', null, 'buyer-id')).toBe(false)
    expect(canPrefillBuyerIdentity('buyer', 'other-buyer', 'buyer-id')).toBe(false)
  })
})

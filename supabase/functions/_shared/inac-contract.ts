export type InacOperation = 'add' | 'edit' | 'delete'

export interface InacTicket {
  id: string
  pedido_id: string
  tipo_ingresso: string
  inac_id?: string | null
}

export interface InacParticipant {
  id: string
  nome_completo: string
  email: string
  cpf: string
  telefone: string
  nome_empresa?: string
  profissao?: string
}

const categoryIds: Record<string, number> = {
  GOLD: 6123,
  PLATINUM: 6125,
  PALESTRANTES: 7863,
  HACKATHON: 7864,
}

const onlyDigits = (value = '') => value.replace(/\D/g, '')
const clean = (value = '') =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export function inacEndpoint(baseUrl: string, operation: InacOperation): string {
  if (/\/attendees\/(add|edit|delete)\/?$/i.test(baseUrl)) {
    return baseUrl.replace(/\/(add|edit|delete)\/?$/i, `/${operation}`)
  }
  return `${baseUrl.replace(/\/$/, '')}/attendees/${operation}`
}

export function inacHttpMethod(operation: InacOperation): 'POST' | 'PUT' | 'DELETE' {
  if (operation === 'edit') return 'PUT'
  if (operation === 'delete') return 'DELETE'
  return 'POST'
}

export function makeInacPayload(
  operation: InacOperation,
  ticket: InacTicket,
  participant: InacParticipant,
  overrides: Record<string, unknown> = {},
) {
  const type = String(overrides.tipo_ingresso ?? ticket.tipo_ingresso)
  if (operation === 'delete') {
    return { id: Number(ticket.inac_id) || ticket.inac_id, event_id: 375 }
  }

  const phoneDigits = onlyDigits(String(overrides.telefone ?? participant.telefone))
  const phone = phoneDigits && phoneDigits.length <= 11 ? `55${phoneDigits}` : phoneDigits
  const payload: Record<string, unknown> = {
    event_id: 375,
    category_id: Number(overrides.category_id) || categoryIds[type] || categoryIds.GOLD,
    status: 'active',
    fields: [
      { id: 10133653, value: clean(String(overrides.nome_completo ?? participant.nome_completo)) },
      { id: 10133654, value: clean(String(overrides.email ?? participant.email)).toLowerCase() },
      { id: 10133655, value: onlyDigits(String(overrides.cpf ?? participant.cpf)) },
      { id: 10133656, value: phone },
      {
        id: 10133657,
        value: clean(
          String(
            overrides.nome_empresa ??
              overrides.empresa ??
              participant.nome_empresa ??
              participant.profissao ??
              '',
          ),
        ),
      },
      { id: 10133665, value: clean(ticket.pedido_id) },
    ],
  }
  if (operation === 'edit') payload.id = Number(ticket.inac_id) || ticket.inac_id
  return payload
}

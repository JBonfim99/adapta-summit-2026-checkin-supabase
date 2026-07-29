export interface GuruItem {
  type: 'GOLD' | 'PLATINUM'
  quantity: number
}

export function guruTransactionId(payload: Record<string, any>) {
  return String(payload.payment?.marketplace_id ?? payload.id ?? '').trim()
}

export function guruItems(payload: Record<string, any>): GuruItem[] {
  const source = Array.isArray(payload.items)
    ? payload.items
    : payload.product
      ? [payload.product]
      : []
  const items: GuruItem[] = []
  for (const item of source) {
    const name = `${item?.name ?? ''} ${item?.offer?.name ?? ''}`.toLowerCase()
    if (!name.includes('summit')) continue
    const type = name.includes('platinum') ? 'PLATINUM' : name.includes('gold') ? 'GOLD' : null
    if (!type) continue
    items.push({
      type,
      quantity: Math.min(Math.max(Number(item?.qty ?? 1) || 1, 1), 100),
    })
  }
  return items
}

export function guruBuyer(payload: Record<string, any>) {
  const contact = payload.contact ?? {}
  const phone =
    `${contact.phone_local_code ?? ''}${contact.phone_number ?? ''}` ||
    String(contact.phone ?? contact.telefone ?? '')
  return {
    email: String(contact.email ?? '')
      .trim()
      .toLowerCase(),
    nome: String(contact.name ?? contact.nome ?? '').trim(),
    documento: String(contact.doc ?? contact.document ?? contact.cpf ?? '').replace(/\D/g, ''),
    uf: String(contact.address_state ?? contact.address?.state ?? contact.uf ?? ''),
    cidade: String(contact.address_city ?? contact.address?.city ?? contact.cidade ?? ''),
    telefone: phone,
  }
}

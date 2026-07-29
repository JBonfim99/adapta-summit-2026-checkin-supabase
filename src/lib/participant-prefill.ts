export interface ParticipantBuyerData {
  nome?: string | null
  email?: string | null
  documento?: string | null
  telefone?: string | null
}

export function formatCpf(value?: string | null) {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 11)

  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

export function formatPhone(value?: string | null) {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 11)

  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

export function participantBuyerPrefill(
  buyer?: ParticipantBuyerData | null,
  fallback?: { nome?: string | null; email?: string | null },
) {
  return {
    nome_completo: buyer?.nome?.trim() || fallback?.nome?.trim() || '',
    email: buyer?.email?.trim() || fallback?.email?.trim() || '',
    cpf: formatCpf(buyer?.documento),
    telefone: formatPhone(buyer?.telefone),
  }
}

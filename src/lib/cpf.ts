// Validação de CPF pelos dígitos verificadores. Aceita com ou sem máscara.
export function cpfDigits(value: string): string {
  return (value || '').replace(/\D/g, '')
}

export function isValidCPF(value: string): boolean {
  const cpf = cpfDigits(value)
  if (cpf.length !== 11) return false
  // Rejeita sequências de dígitos iguais (000..., 111..., etc.)
  if (/^(\d)\1{10}$/.test(cpf)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(cpf.charAt(i), 10) * (10 - i)
  let d1 = 11 - (sum % 11)
  if (d1 >= 10) d1 = 0
  if (d1 !== parseInt(cpf.charAt(9), 10)) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(cpf.charAt(i), 10) * (11 - i)
  let d2 = 11 - (sum % 11)
  if (d2 >= 10) d2 = 0
  if (d2 !== parseInt(cpf.charAt(10), 10)) return false

  return true
}

// Cliente da área /helpdesk. Não usa o PocketBase SDK porque a área não tem
// login de usuário: a autenticação é uma senha única enviada no header
// X-Helpdesk-Key, guardada no navegador junto com o nome do atendente.

const BASE = import.meta.env.VITE_POCKETBASE_URL

const KEY_STORAGE = 'helpdesk_key'
const OP_STORAGE = 'helpdesk_operador'

export interface HDParticipante {
  id: string
  nome_completo: string
  email: string
  cpf: string
  telefone: string
  empresa: string
}

export interface HDIngresso {
  id: string
  pedido_id: string
  tipo_ingresso: string
  status: string
  credenciado: boolean
  tem_qr: boolean
  status_webhook: string
  origem: string
  participante: HDParticipante | null
}

export interface HDComprador {
  id: string
  nome: string
  email: string
  documento: string
  telefone: string
  ingressos: HDIngresso[]
}

export interface HDPessoaForm {
  nome_completo: string
  email: string
  cpf: string
  telefone: string
  empresa: string
}

export class HelpdeskAuthError extends Error {}

export const getKey = () => localStorage.getItem(KEY_STORAGE) || ''
export const getOperador = () => localStorage.getItem(OP_STORAGE) || ''
export const saveSession = (key: string, operador: string) => {
  localStorage.setItem(KEY_STORAGE, key)
  localStorage.setItem(OP_STORAGE, operador)
}
export const clearSession = () => {
  localStorage.removeItem(KEY_STORAGE)
  localStorage.removeItem(OP_STORAGE)
}

async function request(path: string, init: RequestInit = {}, key?: string): Promise<any> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Helpdesk-Key': key ?? getKey(),
        ...(init.headers || {}),
      },
    })
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }

  let data: any = {}
  try {
    data = await res.json()
  } catch {
    data = {}
  }

  if (res.status === 401) {
    clearSession()
    throw new HelpdeskAuthError(data.message || 'Sessão expirada. Entre novamente.')
  }
  if (!res.ok) throw new Error(data.message || 'Não foi possível concluir. Tente de novo.')
  return data
}

export async function hdLogin(senha: string, operador: string) {
  await request('/backend/v1/helpdesk/login', { method: 'POST', body: '{}' }, senha)
  saveSession(senha, operador)
}

export async function hdBuscar(q: string): Promise<HDComprador[]> {
  const params = new URLSearchParams({ q, operador: getOperador() })
  const data = await request(`/backend/v1/helpdesk/search?${params.toString()}`)
  return data.compradores || []
}

export async function hdCredenciar(ingressoId: string, pessoa: HDPessoaForm) {
  return request('/backend/v1/helpdesk/credenciar', {
    method: 'POST',
    body: JSON.stringify({ ...pessoa, ingresso_id: ingressoId, operador: getOperador() }),
  })
}

export async function hdEditar(ingressoId: string, pessoa: HDPessoaForm) {
  return request(`/backend/v1/helpdesk/ticket/${ingressoId}/editar`, {
    method: 'POST',
    body: JSON.stringify({ ...pessoa, operador: getOperador() }),
  })
}

export async function hdTrocarTipo(ingressoId: string, tipo: 'GOLD' | 'PLATINUM') {
  return request(`/backend/v1/helpdesk/ticket/${ingressoId}/tipo`, {
    method: 'POST',
    body: JSON.stringify({ tipo, operador: getOperador() }),
  })
}

export async function hdVerQr(ingressoId: string) {
  const params = new URLSearchParams({ operador: getOperador() })
  return request(`/backend/v1/helpdesk/ticket/${ingressoId}/qr?${params.toString()}`)
}

export async function hdGerarQr(ingressoId: string) {
  return request(`/backend/v1/helpdesk/ticket/${ingressoId}/gerar-qr`, {
    method: 'POST',
    body: JSON.stringify({ operador: getOperador() }),
  })
}

// ---------------------------------------------------------------- máscaras

export const mascaraCpf = (v: string) => {
  const d = (v || '').replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

export const mascaraTelefone = (v: string) => {
  const d = (v || '').replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

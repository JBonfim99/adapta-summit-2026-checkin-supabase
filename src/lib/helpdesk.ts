// Cliente da area /helpdesk. O nome do operador acompanha as ações auditadas.
import { backendPublicHeaders, backendUrl } from '@/lib/backend/client'

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
  /** true quando este ingresso é resposta direta da busca */
  match: boolean
  /** quem criou/fez o check-in: balcão (com atendente), admin, API, a própria pessoa */
  origem_info: string
  participante: HDParticipante | null
}

export interface HDComprador {
  id: string
  nome: string
  email: string
  documento: string
  telefone: string
  /** true quando a busca casou com os dados do próprio comprador */
  match_comprador: boolean
  total_ingressos: number
  ingressos_encontrados: number
  ingressos: HDIngresso[]
}

export interface HDPessoaForm {
  nome_completo: string
  email: string
  cpf: string
  telefone: string
  empresa: string
}

// Tempo máximo de espera. Ações que falam com a INAC podem demorar ~15s.
const TIMEOUT_MS = 45000

// Tradução do código HTTP para uma frase que o atendente entende.
function motivoHttp(status: number): string {
  if (status === 400) return 'O servidor recusou os dados enviados'
  if (status === 403) return 'Acesso negado pelo servidor'
  if (status === 404) return 'Registro não encontrado no servidor'
  if (status === 429) return 'Muitas tentativas seguidas — espere alguns segundos'
  if (status === 502) return 'A INAC (sistema das credenciais) não respondeu'
  if (status === 503) return 'O servidor está fora do ar ou reiniciando'
  if (status === 504) return 'O servidor demorou demais para responder'
  if (status >= 500) return 'Erro interno do servidor'
  return 'O servidor recusou a operação'
}

// Junta os avisos que o servidor devolve quando a ação foi feita, mas alguma
// parte dela não saiu perfeita (log não gravado, gravação parcial, etc).
export function avisosDe(res: any): string[] {
  const lista: string[] = Array.isArray(res?.avisos) ? [...res.avisos] : []
  if (res && res.log_ok === false) {
    lista.push(
      'A ação foi feita, mas o registro dela no histórico (/admin/logs) não pôde ser gravado. Anote o que foi feito e avise o suporte.',
    )
  }
  if (res && res.inac_ok === false && res.inac_msg) {
    lista.push(`A INAC não confirmou a credencial. Motivo: ${res.inac_msg}`)
  }
  return lista
}

export const getOperador = () => localStorage.getItem(OP_STORAGE) || ''
export const saveSession = (operador: string) => {
  localStorage.setItem(OP_STORAGE, operador)
}
export const clearSession = () => {
  localStorage.removeItem(OP_STORAGE)
}

async function request(path: string, init: RequestInit = {}): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(backendUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...backendPublicHeaders(),
        ...(init.headers || {}),
      },
    })
  } catch (err: any) {
    clearTimeout(timer)
    if (err?.name === 'AbortError') {
      throw new Error(
        `A operação passou de ${TIMEOUT_MS / 1000} segundos e foi cancelada. ATENÇÃO: ela pode ter sido concluída no servidor — busque a pessoa de novo e confira o resultado ANTES de repetir.`,
      )
    }
    throw new Error(
      `Não deu para falar com o servidor (${err?.message || 'falha de rede'}). Confira a internet e tente de novo.`,
    )
  }
  clearTimeout(timer)

  let texto = ''
  try {
    texto = await res.text()
  } catch {
    texto = ''
  }

  let data: any = null
  let jsonOk = false
  if (texto) {
    try {
      data = JSON.parse(texto)
      jsonOk = true
    } catch {
      jsonOk = false
    }
  }

  if (!res.ok) {
    const doServidor = data?.message || data?.error || (!jsonOk ? texto.slice(0, 200) : '')
    throw new Error(`${doServidor || motivoHttp(res.status)} (código ${res.status})`)
  }

  if (!jsonOk) {
    throw new Error(
      `O servidor respondeu algo que o sistema não entendeu (código ${res.status}). Tente de novo; se repetir, chame o suporte.`,
    )
  }

  return data
}

export async function hdLogin(operador: string) {
  saveSession(operador)
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

export async function hdTrocarTipo(ingressoId: string, tipo: string, motivo: string) {
  return request(`/backend/v1/helpdesk/ticket/${ingressoId}/tipo`, {
    method: 'POST',
    body: JSON.stringify({ tipo, motivo, operador: getOperador() }),
  })
}

export interface HDNovoCredenciamento extends HDPessoaForm {
  tipo: string
  motivo: string
}

export async function hdNovoCredenciamento(dados: HDNovoCredenciamento) {
  return request('/backend/v1/helpdesk/novo-credenciamento', {
    method: 'POST',
    body: JSON.stringify({ ...dados, operador: getOperador() }),
  })
}

export async function hdReenviarComprador(compradorId: string) {
  return request(`/backend/v1/helpdesk/comprador/${compradorId}/reenviar`, {
    method: 'POST',
    body: JSON.stringify({ operador: getOperador() }),
  })
}

export async function hdReenviarParticipante(ingressoId: string) {
  return request(`/backend/v1/helpdesk/ticket/${ingressoId}/reenviar`, {
    method: 'POST',
    body: JSON.stringify({ operador: getOperador() }),
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

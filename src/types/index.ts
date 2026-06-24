export type TicketStatus = 'pendente' | 'preenchido' | 'enviado' | 'erro_webhook'
export type TicketType = 'GOLD' | 'PLATINUM'

export interface Ticket {
  id: string
  pedido_id?: string
  type: TicketType
  status: TicketStatus
  buyerEmail?: string
  participantName?: string
  pendingLink?: string | null
}

export interface Participant {
  id: string
  ticketId: string
  name: string
  email: string
  cpf: string
  phone: string
  company: string
  role: string
  niche: string
  employees: string
  revenue: string
}

export interface WebhookLog {
  id: string
  date: string
  status: number
  method: string
  response: string
}

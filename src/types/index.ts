export type TicketStatus = 'pending' | 'filled'
export type TicketType = 'VIP' | 'Standard'

export interface Ticket {
  id: string
  type: TicketType
  status: TicketStatus
  buyerEmail: string
  participantName?: string
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

export interface User {
  email: string
  role: 'buyer' | 'admin'
}

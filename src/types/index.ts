export interface Ticket {
  id: string
  pedido_id: string
  displayId?: string
  type: string
  status: string
  participantName?: string
  participantEmail?: string
  participantCpf?: string
  pendingLink?: string | null
}

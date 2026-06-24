import React, { createContext, useContext, useState } from 'react'
import type { Ticket, Participant, WebhookLog, User } from '@/types'

interface AppContextType {
  user: User | null
  login: (email: string) => void
  logout: () => void
  tickets: Ticket[]
  participants: Participant[]
  webhooks: WebhookLog[]
  updateTicket: (id: string, data: Partial<Ticket>) => void
  addParticipant: (participant: Participant) => void
}

const mockTickets: Ticket[] = [
  {
    id: 'TKT-001',
    type: 'VIP',
    status: 'filled',
    buyerEmail: 'buyer@test.com',
    participantName: 'João Silva',
  },
  { id: 'TKT-002', type: 'Standard', status: 'pending', buyerEmail: 'buyer@test.com' },
  { id: 'TKT-003', type: 'Standard', status: 'pending', buyerEmail: 'buyer@test.com' },
]

const mockParticipants: Participant[] = [
  {
    id: 'P-001',
    ticketId: 'TKT-001',
    name: 'João Silva',
    email: 'joao@example.com',
    cpf: '111.222.333-44',
    phone: '11999999999',
    company: 'Tech Corp',
    role: 'C-level/Diretor/Head',
    niche: 'Tecnologia',
    employees: '11-50',
    revenue: 'R$4M-R$10M',
  },
]

const mockWebhooks: WebhookLog[] = [
  {
    id: 'WH-001',
    date: new Date().toISOString(),
    status: 200,
    method: 'POST',
    response: '{"success": true}',
  },
  {
    id: 'WH-002',
    date: new Date(Date.now() - 86400000).toISOString(),
    status: 500,
    method: 'POST',
    response: '{"error": "timeout"}',
  },
]

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>(mockTickets)
  const [participants, setParticipants] = useState<Participant[]>(mockParticipants)
  const [webhooks] = useState<WebhookLog[]>(mockWebhooks)

  const login = (email: string) => {
    setUser({ email, role: email.includes('admin') ? 'admin' : 'buyer' })
  }

  const logout = () => setUser(null)

  const updateTicket = (id: string, data: Partial<Ticket>) => {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)))
  }

  const addParticipant = (participant: Participant) => {
    setParticipants((prev) => [...prev, participant])
  }

  return (
    <AppContext.Provider
      value={{ user, login, logout, tickets, participants, webhooks, updateTicket, addParticipant }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) throw new Error('useApp must be used within an AppProvider')
  return context
}

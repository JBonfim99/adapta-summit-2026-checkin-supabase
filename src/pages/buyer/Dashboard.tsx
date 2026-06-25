import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { TicketCard } from '@/components/TicketCard'
import { Countdown } from '@/components/Countdown'
import { useRealtime } from '@/hooks/use-realtime'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Ticket } from '@/types'
import { useToast } from '@/hooks/use-toast'
import { Copy, MessageCircle } from 'lucide-react'
import pb from '@/lib/pocketbase/client'

export default function BuyerDashboard() {
  const { buyer, logoutBuyer } = useApp()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [inviteTicket, setInviteTicket] = useState<{ t: Ticket; link: string } | null>(null)
  const [loadingTicketId, setLoadingTicketId] = useState<string | null>(null)

  const loadTickets = useCallback(async () => {
    if (!buyer) return
    try {
      const data = await pb.send('/backend/v1/buyer/tickets?expand=participante_id,comprador_id', {
        headers: { Authorization: `Bearer ${buyer.token}` },
      })

      const formatted = (data.items || []).map((t: any, index: number) => {
        const doc = t.expand?.comprador_id?.documento || buyer.documento || '00000000000'
        return {
          id: t.id,
          pedido_id: t.pedido_id,
          displayId: `${doc}-${(index + 1).toString().padStart(2, '0')}`,
          type: t.tipo_ingresso,
          status: t.status,
          participantName: t.expand?.participante_id?.nome_completo,
          participantEmail: t.expand?.participante_id?.email,
          participantCpf: t.expand?.participante_id?.cpf,
          pendingLink: t.pending_link || null,
        }
      })
      setTickets(formatted)
    } catch (err) {
      logoutBuyer()
    }
  }, [buyer, logoutBuyer])

  useEffect(() => {
    loadTickets()
  }, [loadTickets])

  useRealtime('ingressos', () => {
    loadTickets()
  })
  useRealtime('participantes', () => {
    loadTickets()
  })

  if (!buyer) return <Navigate to="/" replace />

  const filledCount = tickets.filter((t) => t.status === 'Pré-Credenciado').length
  const totalCount = tickets.length

  const getInviteToken = async (ticketId: string, force: boolean = false) => {
    const data = await pb.send(
      `/backend/v1/buyer/tickets/${ticketId}/invite${force ? '?force=true' : ''}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer.token}` },
      },
    )
    return data.token
  }

  const handleFill = async (ticket: Ticket) => {
    try {
      setLoadingTicketId(ticket.id)
      const token = await getInviteToken(ticket.id, true)
      navigate(
        `/credenciamento?token=${token}&nome=${encodeURIComponent(buyer.nome)}&email=${encodeURIComponent(buyer.email)}`,
      )
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' })
    } finally {
      setLoadingTicketId(null)
    }
  }

  const handleInvite = async (ticket: Ticket) => {
    try {
      const token = ticket.pendingLink || (await getInviteToken(ticket.id))
      setInviteTicket({
        t: ticket,
        link: `${window.location.origin}/credenciamento?token=${token}`,
      })
      if (!ticket.pendingLink) loadTickets()
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' })
    }
  }

  const copyLink = () => {
    if (!inviteTicket) return
    navigator.clipboard.writeText(inviteTicket.link)
    toast({
      title: 'Link copiado!',
      description: 'O link de convite foi copiado para sua área de transferência.',
    })
  }

  const shareWhatsApp = () => {
    if (!inviteTicket) return
    const text = `Você foi convidado para o Adapta Summit 2026! Preencha seus dados para receber o ingresso: ${inviteTicket.link}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meus Ingressos</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Você preencheu {filledCount} de {totalCount} ingressos
          </p>
        </div>
        <Countdown targetDate="2026-07-31T09:00:00-03:00" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            onFill={() => handleFill(ticket)}
            onInvite={() => handleInvite(ticket)}
            isLoadingFill={loadingTicketId === ticket.id}
          />
        ))}
      </div>

      {tickets.length === 0 && (
        <div className="text-center py-20 bg-muted/30 rounded-xl border border-dashed">
          <p className="text-muted-foreground">Nenhum ingresso encontrado.</p>
        </div>
      )}

      <Dialog open={!!inviteTicket} onOpenChange={(open) => !open && setInviteTicket(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar Participante</DialogTitle>
            <DialogDescription>
              Compartilhe este link com a pessoa que vai utilizar o ingresso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="flex items-center gap-2">
              <Input value={inviteTicket?.link || ''} readOnly className="font-mono text-sm" />
              <Button
                onClick={copyLink}
                size="icon"
                variant="outline"
                className="shrink-0 hover:bg-accent hover:text-white transition-colors"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>

            <Button
              className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-sm hover:shadow-md transition-all duration-300 hover:scale-[1.02] flex items-center justify-center gap-2"
              onClick={shareWhatsApp}
            >
              <MessageCircle className="h-5 w-5" />
              Compartilhar no WhatsApp
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

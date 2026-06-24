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
import { Copy, Share2, LogOut } from 'lucide-react'
import pb from '@/lib/pocketbase/client'

export default function BuyerDashboard() {
  const { buyer, logoutBuyer } = useApp()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [inviteTicket, setInviteTicket] = useState<{ t: Ticket; link: string } | null>(null)
  const [imgError, setImgError] = useState(false)

  const loadTickets = useCallback(() => {
    if (!buyer) return
    pb.send('/backend/v1/buyer/tickets?expand=participante_id', {
      headers: { Authorization: `Bearer ${buyer.token}` },
    })
      .then((data) => {
        const formatted = (data.items || []).map((t: any) => ({
          id: t.id,
          pedido_id: t.pedido_id,
          type: t.tipo_ingresso,
          status: t.status,
          participantName: t.expand?.participante_id?.nome_completo,
          participantEmail: t.expand?.participante_id?.email,
          participantCpf: t.expand?.participante_id?.cpf,
          pendingLink: t.pending_link || null,
        }))
        setTickets(formatted)
      })
      .catch(() => {
        logoutBuyer()
      })
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

  const filledCount = tickets.filter((t) => t.status !== 'pendente').length
  const totalCount = tickets.length

  const getInviteToken = async (ticketId: string) => {
    const data = await pb.send(`/backend/v1/buyer/tickets/${ticketId}/invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer.token}` },
    })
    return data.token
  }

  const handleFill = async (ticket: Ticket) => {
    try {
      const token = ticket.pendingLink || (await getInviteToken(ticket.id))
      navigate(
        `/participante?token=${token}&nome=${encodeURIComponent(buyer.nome)}&email=${encodeURIComponent(buyer.email)}`,
      )
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' })
    }
  }

  const handleInvite = async (ticket: Ticket) => {
    try {
      const token = ticket.pendingLink || (await getInviteToken(ticket.id))
      setInviteTicket({ t: ticket, link: `${window.location.origin}/participante?token=${token}` })
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
      description: 'Envie este link para o participante preencher os dados.',
    })
  }

  const shareWhatsApp = () => {
    if (!inviteTicket) return
    const message = `Olá! Aqui está o seu ingresso para o Adapta Summit 2026. Por favor, preencha seus dados para confirmar sua presença através deste link: ${inviteTicket.link}`
    window.open(`https://wa.me/send?text=${encodeURIComponent(message)}`, '_blank')
  }

  return (
    <div className="space-y-8 animate-fade-in-up pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
        <div>
          <div className="mb-6">
            {!imgError ? (
              <img
                src="https://img.usecurling.com/i?q=mountain&color=black&shape=fill"
                alt="Adapta Summit 2026"
                width="200"
                height="48"
                className="h-10 md:h-12 w-auto min-w-[150px] object-contain object-left"
                onError={() => setImgError(true)}
              />
            ) : (
              <h2 className="text-2xl font-bold tracking-tight">Adapta Summit</h2>
            )}
          </div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">Meus Ingressos</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={logoutBuyer}
              className="text-muted-foreground"
            >
              <LogOut className="w-4 h-4 mr-2" /> Sair
            </Button>
          </div>
          <p className="text-muted-foreground">
            Olá, {buyer.nome}. Gerencie os participantes do seu pedido.
          </p>
        </div>
        <div className="bg-slate-100 px-4 py-2 rounded-lg flex items-center gap-3 mt-4 md:mt-0">
          <span className="text-sm font-medium">Progresso</span>
          <div className="text-lg font-bold text-primary">
            {filledCount} / {totalCount}
          </div>
        </div>
      </div>

      <div className="flex justify-center md:justify-start py-2">
        <Countdown />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} onFill={handleFill} onInvite={handleInvite} />
        ))}
      </div>

      <Dialog open={!!inviteTicket} onOpenChange={(open) => !open && setInviteTicket(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar Participante</DialogTitle>
            <DialogDescription>
              Compartilhe o link abaixo com a pessoa que irá utilizar este ingresso.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 mt-4">
            <div className="grid flex-1 gap-2">
              <Input
                readOnly
                value={inviteTicket?.link || ''}
                className="bg-slate-50 font-mono text-sm"
              />
            </div>
            <Button type="button" size="icon" onClick={copyLink}>
              <span className="sr-only">Copiar</span>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-6 flex justify-center">
            <Button
              variant="outline"
              className="w-full gap-2 border-green-500 text-green-600 hover:bg-green-50"
              onClick={shareWhatsApp}
            >
              <Share2 className="w-4 h-4" />
              Compartilhar no WhatsApp
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

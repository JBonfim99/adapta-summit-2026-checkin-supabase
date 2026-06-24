import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { TicketCard } from '@/components/TicketCard'
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
import { Copy, Share2 } from 'lucide-react'

export default function BuyerDashboard() {
  const { user, tickets } = useApp()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [inviteTicket, setInviteTicket] = useState<Ticket | null>(null)

  if (!user || user.role !== 'buyer') return <Navigate to="/" replace />

  const userTickets = tickets.filter((t) => t.buyerEmail === user.email)
  const filledCount = userTickets.filter((t) => t.status === 'filled').length
  const totalCount = userTickets.length

  const handleFill = (ticket: Ticket) => {
    navigate(`/participante/${ticket.id}`)
  }

  const copyLink = () => {
    if (!inviteTicket) return
    const link = `${window.location.origin}/participante/${inviteTicket.id}`
    navigator.clipboard.writeText(link)
    toast({
      title: 'Link copiado!',
      description: 'Envie este link para o participante preencher os dados.',
    })
  }

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Meus Ingressos</h1>
          <p className="text-muted-foreground">Gerencie os participantes do seu pedido.</p>
        </div>
        <div className="bg-slate-100 px-4 py-2 rounded-lg flex items-center gap-3">
          <span className="text-sm font-medium">Progresso</span>
          <div className="text-lg font-bold text-primary">
            {filledCount} / {totalCount}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {userTickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            onFill={handleFill}
            onInvite={setInviteTicket}
          />
        ))}
      </div>

      <Dialog open={!!inviteTicket} onOpenChange={(open) => !open && setInviteTicket(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convidar Participante</DialogTitle>
            <DialogDescription>
              Compartilhe o link abaixo com a pessoa que irá utilizar o ingresso {inviteTicket?.id}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 mt-4">
            <div className="grid flex-1 gap-2">
              <Input
                readOnly
                value={`${window.location.origin}/participante/${inviteTicket?.id}`}
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
              onClick={copyLink}
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

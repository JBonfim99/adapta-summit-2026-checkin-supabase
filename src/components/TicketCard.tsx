import { Ticket } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from './StatusBadge'
import { Button } from '@/components/ui/button'
import { User, Copy, Edit, QrCode } from 'lucide-react'

interface TicketCardProps {
  ticket: Ticket
  onInvite: (ticket: Ticket) => void
  onFill: (ticket: Ticket) => void
}

export function TicketCard({ ticket, onInvite, onFill }: TicketCardProps) {
  const isFilled = ticket.status === 'filled'

  return (
    <Card className="group hover:shadow-elevation transition-all duration-300 border-slate-200 overflow-hidden">
      <div className="h-2 w-full bg-slate-100">
        <div
          className={`h-full w-full ${ticket.type === 'VIP' ? 'bg-amber-500' : 'bg-slate-300'}`}
        />
      </div>
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="text-sm font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              {ticket.type} Ticket
            </div>
            <div className="text-lg font-bold text-foreground">{ticket.id}</div>
          </div>
          <StatusBadge status={ticket.status} />
        </div>

        {isFilled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-lg border border-slate-100">
              <div className="bg-primary/10 p-2 rounded-full text-primary">
                <User className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Participante</p>
                <p className="font-semibold text-foreground">{ticket.participantName}</p>
              </div>
            </div>
            <Button variant="outline" className="w-full text-muted-foreground" disabled>
              <QrCode className="w-4 h-4 mr-2" />
              QR Code enviado
            </Button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <Button
              className="flex-1 bg-primary hover:bg-primary/90"
              onClick={() => onFill(ticket)}
            >
              <Edit className="w-4 h-4 mr-2" />
              Preencher
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-accent text-accent hover:bg-accent/10"
              onClick={() => onInvite(ticket)}
            >
              <Copy className="w-4 h-4 mr-2" />
              Convidar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

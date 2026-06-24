import { Ticket } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from './StatusBadge'
import { Button } from '@/components/ui/button'
import { User, Copy, Edit, QrCode, Mail, IdCard } from 'lucide-react'

interface TicketCardProps {
  ticket: Ticket
  onInvite: (ticket: Ticket) => void
  onFill: (ticket: Ticket) => void
}

const formatCpf = (cpf?: string) => {
  if (!cpf) return ''
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return cpf
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`
}

export function TicketCard({ ticket, onInvite, onFill }: TicketCardProps) {
  const isFilled = ticket.status !== 'pendente'

  return (
    <Card className="group hover:shadow-elevation transition-all duration-300 border-slate-200 overflow-hidden flex flex-col">
      <div className="h-2 w-full bg-slate-100 flex-shrink-0">
        <div
          className={`h-full w-full ${ticket.type === 'GOLD' ? 'bg-yellow-500' : ticket.type === 'PLATINUM' ? 'bg-slate-800' : 'bg-slate-300'}`}
        />
      </div>
      <CardContent className="p-6 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="text-sm font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              {ticket.type} Ticket
            </div>
            <div className="text-lg font-bold text-foreground font-mono">{ticket.pedido_id}</div>
          </div>
          <StatusBadge status={ticket.status} />
        </div>

        <div className="mt-auto">
          {isFilled ? (
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
                {!ticket.participantName && !ticket.participantEmail && !ticket.participantCpf ? (
                  <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
                    <User className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-sm font-medium">Aguardando atualização dos dados...</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="bg-primary/10 p-2 rounded-full text-primary flex-shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Nome Completo</p>
                        <p className="font-semibold text-sm text-foreground truncate">
                          {ticket.participantName || 'Preenchido'}
                        </p>
                      </div>
                    </div>
                    {ticket.participantEmail && (
                      <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-full text-primary flex-shrink-0">
                          <Mail className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Email</p>
                          <p className="font-medium text-sm text-foreground truncate">
                            {ticket.participantEmail}
                          </p>
                        </div>
                      </div>
                    )}
                    {ticket.participantCpf && (
                      <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-full text-primary flex-shrink-0">
                          <IdCard className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">CPF</p>
                          <p className="font-medium text-sm text-foreground truncate">
                            {formatCpf(ticket.participantCpf)}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <Button variant="outline" className="w-full text-muted-foreground" disabled>
                <QrCode className="w-4 h-4 mr-2" />
                QR Code enviado
              </Button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3">
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
        </div>
      </CardContent>
    </Card>
  )
}

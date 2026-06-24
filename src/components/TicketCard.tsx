import { Ticket } from '@/types'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Mail, PenSquare, CheckCircle2, UserPlus } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'

interface TicketCardProps {
  ticket: Ticket
  onFill: () => void
  onInvite: () => void
}

export function TicketCard({ ticket, onFill, onInvite }: TicketCardProps) {
  const isPendente = ticket.status === 'pendente'
  const isEnviado = ticket.status === 'enviado'

  return (
    <Card className="flex flex-col h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/20 group">
      <CardHeader className="bg-muted/30 pb-4 border-b">
        <div className="flex justify-between items-start mb-2">
          <Badge variant="outline" className="bg-background">
            Pedido #{ticket.pedido_id?.slice(-6) || 'N/A'}
          </Badge>
          <StatusBadge status={ticket.status} />
        </div>
        <h3 className="font-semibold text-lg">{ticket.type}</h3>
      </CardHeader>

      <CardContent className="flex-1 pt-6">
        {isPendente ? (
          <div className="text-center space-y-2 py-4">
            <UserPlus className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Ingresso aguardando dados do participante
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Nome</p>
              <p className="font-medium">{ticket.participantName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">E-mail</p>
              <p className="text-sm">{ticket.participantEmail}</p>
            </div>
            {isEnviado && (
              <div className="flex items-center gap-2 mt-4 text-green-600 bg-green-50 p-3 rounded-md">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p className="text-sm font-medium">QR Code enviado para o e-mail</p>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="border-t pt-4 bg-muted/10">
        {isPendente && (
          <div className="grid grid-cols-2 gap-3 w-full">
            <Button
              variant="outline"
              onClick={onFill}
              className="w-full hover:bg-primary hover:text-primary-foreground transition-all duration-300 hover:shadow-md hover:scale-[1.02]"
            >
              <PenSquare className="w-4 h-4 mr-2" />
              Preencher
            </Button>
            <Button
              onClick={onInvite}
              className="w-full transition-all duration-300 hover:shadow-md hover:scale-[1.02]"
            >
              <Mail className="w-4 h-4 mr-2" />
              Convidar
            </Button>
          </div>
        )}
        {!isPendente && (
          <Button variant="ghost" className="w-full opacity-50 cursor-not-allowed">
            Dados preenchidos
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

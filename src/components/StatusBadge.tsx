import { Badge } from '@/components/ui/badge'
import { TicketStatus } from '@/types'
import { cn } from '@/lib/utils'
import { CheckCircle2, Clock } from 'lucide-react'

interface StatusBadgeProps {
  status: TicketStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const isFilled = status === 'filled'

  return (
    <Badge
      variant="outline"
      className={cn(
        'px-3 py-1 text-sm font-medium border-0 gap-1.5',
        isFilled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800',
      )}
    >
      {isFilled ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
      {isFilled ? 'Preenchido' : 'Pendente'}
    </Badge>
  )
}

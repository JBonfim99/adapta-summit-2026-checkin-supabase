import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, AlertCircle, Send } from 'lucide-react'

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (status === 'preenchido') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1 hover:bg-emerald-100">
        <CheckCircle2 className="w-3.5 h-3.5" /> Preenchido
      </Badge>
    )
  }
  if (status === 'enviado') {
    return (
      <Badge className="bg-blue-100 text-blue-800 border-0 gap-1 hover:bg-blue-100">
        <Send className="w-3.5 h-3.5" /> INAC OK
      </Badge>
    )
  }
  if (status === 'erro_webhook') {
    return (
      <Badge className="bg-rose-100 text-rose-800 border-0 gap-1 hover:bg-rose-100">
        <AlertCircle className="w-3.5 h-3.5" /> Erro Sync
      </Badge>
    )
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 border-0 gap-1 hover:bg-amber-100">
      <Clock className="w-3.5 h-3.5" /> Pendente
    </Badge>
  )
}

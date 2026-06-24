import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, AlertCircle, Send } from 'lucide-react'

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (status === 'preenchido') {
    return (
      <Badge className="bg-purple-100 text-purple-800 border-0 gap-1 hover:bg-purple-100">
        <CheckCircle2 className="w-3.5 h-3.5" /> Preenchido
      </Badge>
    )
  }
  if (status === 'enviado') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-0 gap-1 hover:bg-emerald-100">
        <Send className="w-3.5 h-3.5" /> Enviado
      </Badge>
    )
  }
  if (status === 'erro_webhook') {
    return (
      <Badge className="bg-rose-100 text-rose-800 border-0 gap-1 hover:bg-rose-100">
        <AlertCircle className="w-3.5 h-3.5" /> Erro Webhook
      </Badge>
    )
  }
  return (
    <Badge className="bg-slate-100 text-slate-800 border-0 gap-1 hover:bg-slate-100">
      <Clock className="w-3.5 h-3.5" /> Pendente
    </Badge>
  )
}

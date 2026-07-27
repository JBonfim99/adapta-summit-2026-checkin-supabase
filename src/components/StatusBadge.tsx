import { Badge } from '@/components/ui/badge'
import { classeTipo } from '@/lib/ticket-types'

export function StatusBadge({ status }: { status: string }) {
  switch (status?.toLowerCase()) {
    case 'pendente':
      return (
        <Badge
          variant="secondary"
          className="whitespace-nowrap bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200"
        >
          Pendente
        </Badge>
      )
    case 'pré-credenciado':
    case 'pre-credenciado':
    case 'preenchido':
      return (
        <Badge
          variant="secondary"
          className="whitespace-nowrap bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200"
        >
          Check-in feito
        </Badge>
      )
    case 'enviado':
      return (
        <Badge
          variant="secondary"
          className="whitespace-nowrap bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200"
        >
          Enviado (INAC)
        </Badge>
      )
    case 'erro_webhook':
      return (
        <Badge variant="destructive" className="whitespace-nowrap">
          Erro Sync
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="whitespace-nowrap">
          {status || 'Desconhecido'}
        </Badge>
      )
  }
}

export function TypeBadge({ type }: { type: string }) {
  const t = (type || '').toUpperCase()
  if (!t) return <Badge variant="outline">N/A</Badge>
  return (
    <Badge variant="secondary" className={`whitespace-nowrap ${classeTipo(t)}`}>
      {t}
    </Badge>
  )
}

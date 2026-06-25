import { Badge } from '@/components/ui/badge'

export function StatusBadge({ status }: { status: string }) {
  switch (status?.toLowerCase()) {
    case 'pendente':
      return (
        <Badge
          variant="secondary"
          className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200"
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
          className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200"
        >
          Pré-Credenciado
        </Badge>
      )
    case 'enviado':
      return (
        <Badge
          variant="secondary"
          className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200"
        >
          Enviado (INAC)
        </Badge>
      )
    case 'erro_webhook':
      return <Badge variant="destructive">Erro Sync</Badge>
    default:
      return <Badge variant="outline">{status || 'Desconhecido'}</Badge>
  }
}

export function TypeBadge({ type }: { type: string }) {
  switch (type?.toUpperCase()) {
    case 'GOLD':
      return (
        <Badge
          variant="secondary"
          className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200"
        >
          GOLD
        </Badge>
      )
    case 'PLATINUM':
      return (
        <Badge
          variant="secondary"
          className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 border-indigo-200"
        >
          PLATINUM
        </Badge>
      )
    default:
      return <Badge variant="outline">{type || 'N/A'}</Badge>
  }
}

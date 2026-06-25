import { Badge } from '@/components/ui/badge'

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'Pendente':
    case 'pendente':
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
          Pendente
        </Badge>
      )
    case 'Pré-Credenciado':
    case 'preenchido':
      return (
        <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          Pré-Credenciado
        </Badge>
      )
    case 'enviado':
      return (
        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
          Enviado (INAC)
        </Badge>
      )
    case 'erro_webhook':
      return <Badge variant="destructive">Erro Sync</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

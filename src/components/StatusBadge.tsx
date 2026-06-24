import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  switch (status) {
    case 'pendente':
      return (
        <Badge
          variant="secondary"
          className={cn('bg-yellow-100 text-yellow-800 hover:bg-yellow-100', className)}
        >
          Pendente
        </Badge>
      )
    case 'preenchido':
      return (
        <Badge
          variant="secondary"
          className={cn('bg-blue-100 text-blue-800 hover:bg-blue-100', className)}
        >
          Preenchido
        </Badge>
      )
    case 'enviado':
      return (
        <Badge
          variant="secondary"
          className={cn('bg-green-100 text-green-800 hover:bg-green-100', className)}
        >
          Enviado
        </Badge>
      )
    case 'erro_webhook':
      return (
        <Badge variant="destructive" className={className}>
          Erro no envio
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className={className}>
          {status}
        </Badge>
      )
  }
}

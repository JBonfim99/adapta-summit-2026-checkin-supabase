import { useApp } from '@/contexts/app-context'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RotateCw, CheckCircle2, XCircle } from 'lucide-react'

export default function AdminWebhooks() {
  const { webhooks } = useApp()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Logs de Sincronização (INAC)</h2>
        <p className="text-muted-foreground">
          Monitore o envio de dados para a API externa de credenciais.
        </p>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>ID / Data</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Status HTTP</TableHead>
              <TableHead>Resposta</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <div className="font-medium">{log.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(log.date).toLocaleString()}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono bg-slate-100">
                    {log.method}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {log.status === 200 ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-500" />
                    )}
                    <span
                      className={
                        log.status === 200
                          ? 'text-emerald-700 font-medium'
                          : 'text-rose-700 font-medium'
                      }
                    >
                      {log.status}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <code className="text-xs bg-slate-50 p-1 rounded border">{log.response}</code>
                </TableCell>
                <TableCell className="text-right">
                  {log.status !== 200 && (
                    <Button variant="ghost" size="sm" className="h-8 gap-1">
                      <RotateCw className="w-3 h-3" /> Retentar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

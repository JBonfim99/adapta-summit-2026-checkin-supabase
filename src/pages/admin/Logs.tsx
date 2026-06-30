import { useState, useEffect } from 'react'
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
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

const EVENTO_LABELS: Record<string, string> = {
  webhook_enviado: 'Webhook enviado',
  webhook_erro: 'Falha no webhook',
  webhook_reenviado: 'Reenvio manual',
  webhook_reenvio_erro: 'Falha no reenvio',
}

export default function AdminLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const { toast } = useToast()

  const loadData = () => {
    pb.collection('webhooks_log')
      .getFullList({ expand: 'ingresso_id', sort: '-created' })
      .then((res) => setLogs(res))
      .catch(() => {})
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleRetry = async (ingressoId: string) => {
    try {
      await pb.send(`/backend/v1/admin/retry-webhook/${ingressoId}`, { method: 'POST' })
      toast({ title: 'Sucesso', description: 'Webhook reenviado com sucesso.' })
      loadData()
    } catch (e: any) {
      toast({ title: 'Falha no reenvio', description: e.message, variant: 'destructive' })
      loadData()
    }
  }

  const isOk = (status: number) => status >= 200 && status < 300

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold">Logs</h2>
        <p className="text-muted-foreground">
          Cada evento de envio ao INAC, registrado após a finalização do participante.
        </p>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Evento</TableHead>
              <TableHead>ID do ingresso</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Status HTTP</TableHead>
              <TableHead>Detalhe</TableHead>
              <TableHead>Resposta</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => {
              const ok = isOk(log.status)
              return (
                <TableRow key={log.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        ok
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-rose-200 bg-rose-50 text-rose-700'
                      }
                    >
                      {EVENTO_LABELS[log.evento] || log.evento || '-'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium font-mono text-sm">
                      {log.expand?.ingresso_id?.pedido_id || '-'}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                    {new Date(log.created).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-500" />
                      )}
                      <span
                        className={
                          ok ? 'text-emerald-700 font-medium' : 'text-rose-700 font-medium'
                        }
                      >
                        {log.status}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[280px] text-sm text-slate-700">{log.detalhe || '-'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[280px] max-h-16 overflow-auto">
                      <code className="text-xs bg-slate-50 p-1 rounded border text-slate-600 block break-all">
                        {log.response || 'Sem corpo de resposta'}
                      </code>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {!ok && log.ingresso_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => handleRetry(log.ingresso_id)}
                      >
                        <RotateCw className="w-3 h-3" /> Retentar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Nenhum log ainda. Os registros aparecem após o disparo do webhook.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

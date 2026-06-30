import { useState, useEffect, useMemo } from 'react'
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
import { RotateCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

export default function AdminLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [retryingAll, setRetryingAll] = useState(false)
  const [retryingId, setRetryingId] = useState('')
  const [filter, setFilter] = useState<'erros' | 'todos' | 'ok'>('erros')
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

  const isOk = (status: number) => status >= 200 && status < 300

  // Agrega: 1 linha por ingresso (pedido), mantendo o evento MAIS RECENTE.
  const aggregated = useMemo(() => {
    const byIng: Record<string, any> = {}
    for (const log of logs) {
      const iid = log.ingresso_id
      if (!iid) continue
      const prev = byIng[iid]
      if (!prev || new Date(log.created).getTime() > new Date(prev.created).getTime()) {
        byIng[iid] = log
      }
    }
    return Object.values(byIng).sort(
      (a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime(),
    )
  }, [logs])

  // Estado de erro real do ingresso (não só do log): credenciado => nunca é erro.
  const rowIsError = (log: any) => {
    const ing = log.expand?.ingresso_id
    if (ing?.inac_id) return false
    const sw = ing?.status_webhook
    return sw ? sw === 'erro' : !isOk(log.status)
  }

  const errorCount = aggregated.filter(rowIsError).length
  const visible = aggregated.filter((log: any) =>
    filter === 'todos' ? true : filter === 'erros' ? rowIsError(log) : !rowIsError(log),
  )

  const handleRetry = async (ingressoId: string) => {
    setRetryingId(ingressoId)
    try {
      await pb.send(`/backend/v1/admin/retry-webhook/${ingressoId}`, { method: 'POST' })
      toast({ title: 'Sucesso', description: 'Webhook reenviado.' })
      loadData()
    } catch (e: any) {
      toast({ title: 'Falha no reenvio', description: e.message, variant: 'destructive' })
      loadData()
    } finally {
      setRetryingId('')
    }
  }

  const handleRetryAll = async () => {
    setRetryingAll(true)
    try {
      const res: any = await pb.send('/backend/v1/admin/retry-webhook-all', { method: 'POST' })
      toast({
        title: 'Reenvio concluído',
        description: `${res.ok || 0} reenviado(s), ${res.failed || 0} ainda com erro (de ${res.tried || 0} tentados).`,
      })
      loadData()
    } catch (e: any) {
      toast({ title: 'Falha', description: e.message, variant: 'destructive' })
    } finally {
      setRetryingAll(false)
    }
  }

  const FILTERS: Array<['erros' | 'todos' | 'ok', string]> = [
    ['erros', `Somente erros${errorCount > 0 ? ` (${errorCount})` : ''}`],
    ['todos', 'Todos'],
    ['ok', 'Somente OK'],
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Logs</h2>
          <p className="text-muted-foreground">
            Um registro por ingresso (pedido), com o status mais recente do envio ao INAC.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2 shrink-0"
          onClick={handleRetryAll}
          disabled={retryingAll || errorCount === 0}
        >
          {retryingAll ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RotateCw className="w-4 h-4" />
          )}
          Retentar erros{errorCount > 0 ? ` (${errorCount})` : ''}
        </Button>
      </div>

      <div className="flex gap-2">
        {FILTERS.map(([k, label]) => (
          <Button
            key={k}
            variant={filter === k ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(k)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>ID do ingresso</TableHead>
              <TableHead>Última tentativa</TableHead>
              <TableHead>HTTP</TableHead>
              <TableHead>Detalhe</TableHead>
              <TableHead>Resposta</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((log: any) => {
              const err = rowIsError(log)
              return (
                <TableRow key={log.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        err
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }
                    >
                      {err ? 'Erro' : 'OK'}
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
                      {err ? (
                        <XCircle className="w-4 h-4 text-rose-500" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      )}
                      <span
                        className={
                          err ? 'text-rose-700 font-medium' : 'text-emerald-700 font-medium'
                        }
                      >
                        {log.status}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[260px] text-sm text-slate-700">{log.detalhe || '-'}</div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[260px] max-h-16 overflow-auto">
                      <code className="text-xs bg-slate-50 p-1 rounded border text-slate-600 block break-all">
                        {log.response || 'Sem corpo de resposta'}
                      </code>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {err && log.ingresso_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => handleRetry(log.ingresso_id)}
                        disabled={retryingId === log.ingresso_id}
                      >
                        {retryingId === log.ingresso_id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCw className="w-3 h-3" />
                        )}{' '}
                        Retentar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {filter === 'erros'
                    ? 'Nenhum erro pendente. 🎉'
                    : 'Nenhum registro para este filtro.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

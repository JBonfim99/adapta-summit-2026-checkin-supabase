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
import { RotateCw, CheckCircle2, XCircle, Loader2, Eye } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

// Formata JSON pra leitura; se não for JSON válido, devolve o texto cru.
const pretty = (s: any) => {
  if (!s && s !== 0) return ''
  if (typeof s === 'object') return JSON.stringify(s, null, 2)
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return String(s)
  }
}

// Eventos de ação manual do admin (aparecem como badge próprio nos Logs).
const MANUAL_EVENTOS: Record<string, { label: string; cls: string }> = {
  excluido_manual: { label: 'Excluído', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  editado_manual: { label: 'Editado', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  tipo_alterado: { label: 'Tipo alterado', cls: 'border-violet-200 bg-violet-50 text-violet-700' },
  comprador_excluido: {
    label: 'Comprador excluído',
    cls: 'border-rose-200 bg-rose-50 text-rose-700',
  },
}

// Pedido do log: usa o ingresso expandido; se ele foi excluído, cai no payload.
const pedidoDoLog = (log: any) => {
  if (log?.expand?.ingresso_id?.pedido_id) return log.expand.ingresso_id.pedido_id
  try {
    const p = JSON.parse(log?.payload || '{}')
    return p?.pedido_id || '-'
  } catch {
    return '-'
  }
}

export default function AdminLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [retryingAll, setRetryingAll] = useState(false)
  const [retryingId, setRetryingId] = useState('')
  const [filter, setFilter] = useState<'erros' | 'todos' | 'ok' | 'manuais'>('erros')
  const [detail, setDetail] = useState<any>(null)
  const { toast } = useToast()

  const loadData = () => {
    pb.collection('webhooks_log')
      .getFullList({ expand: 'ingresso_id', sort: '-created' })
      .then((res) => setLogs(res))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const isOk = (status: number) => status >= 200 && status < 300

  // Agrega: 1 linha por ingresso (pedido), mantendo o evento MAIS RECENTE.
  const aggregated = useMemo(() => {
    const byIng: Record<string, any> = {}
    const manualRows: any[] = []
    for (const log of logs) {
      const iid = log.ingresso_id
      const live = !!log.expand?.ingresso_id
      const isManual = !!MANUAL_EVENTOS[log.evento]
      // Evento manual cujo ingresso não existe mais (ex.: exclusão): linha própria.
      if (isManual && !live) {
        manualRows.push(log)
        continue
      }
      // Ignora órfãos de ingressos já excluídos (logs de webhook antigos).
      if (!iid || !live) continue
      const prev = byIng[iid]
      if (!prev || new Date(log.created).getTime() > new Date(prev.created).getTime()) {
        byIng[iid] = log
      }
    }
    return [...Object.values(byIng), ...manualRows].sort(
      (a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime(),
    )
  }, [logs])

  // Estado de erro real do ingresso (não só do log): credenciado => nunca é erro.
  const rowIsError = (log: any) => {
    const ing = log.expand?.ingresso_id
    // Ingresso vivo, sem credencial na INAC e com webhook em erro CONTINUA erro —
    // mesmo que o evento mais recente tenha sido uma edição/troca manual.
    if (ing && !ing.inac_id && ing.status_webhook === 'erro') return true
    if (MANUAL_EVENTOS[log.evento]) return false
    if (ing?.inac_id) return false
    const sw = ing?.status_webhook
    return sw ? sw === 'erro' : !isOk(log.status)
  }

  const errorCount = aggregated.filter(rowIsError).length
  const visible = aggregated.filter((log: any) => {
    if (filter === 'todos') return true
    if (filter === 'manuais') return !!MANUAL_EVENTOS[log.evento]
    if (filter === 'erros') return rowIsError(log)
    return !rowIsError(log)
  })

  const handleRetry = async (ingressoId: string) => {
    setRetryingId(ingressoId)
    try {
      const res: any = await pb.send(`/backend/v1/admin/retry-webhook/${ingressoId}`, {
        method: 'POST',
      })
      if (res && res.success === false) {
        toast({
          title: 'INAC ainda recusou',
          description: `HTTP ${res.status || '-'}. Clique em "Detalhes" pra ver a resposta.`,
          variant: 'destructive',
        })
      } else {
        toast({ title: 'Credenciado', description: 'QR gerado com sucesso.' })
      }
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

  const FILTERS: Array<['erros' | 'todos' | 'ok' | 'manuais', string]> = [
    ['erros', `Somente erros${errorCount > 0 ? ` (${errorCount})` : ''}`],
    ['todos', 'Todos'],
    ['ok', 'Somente OK'],
    ['manuais', 'Ações manuais'],
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
                    {err ? (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                        Erro
                      </Badge>
                    ) : MANUAL_EVENTOS[log.evento] ? (
                      <Badge variant="outline" className={MANUAL_EVENTOS[log.evento].cls}>
                        {MANUAL_EVENTOS[log.evento].label}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        OK
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium font-mono text-sm">{pedidoDoLog(log)}</div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600 whitespace-nowrap">
                    {new Date(log.created).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {MANUAL_EVENTOS[log.evento] ? (
                      <span className="text-slate-400">—</span>
                    ) : (
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
                    )}
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
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => setDetail(log)}
                      >
                        <Eye className="w-3 h-3" /> Detalhes
                      </Button>
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
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {filter === 'erros'
                    ? 'Nenhum erro pendente. 🎉'
                    : 'Nenhum registro para este filtro.'}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhe — pedido {detail ? pedidoDoLog(detail) : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-600">
              <span>
                <b>HTTP:</b> {detail?.status ?? '-'}
              </span>
              <span>
                <b>Quando:</b> {detail ? new Date(detail.created).toLocaleString() : '-'}
              </span>
            </div>
            {detail?.detalhe && <div className="text-slate-700">{detail.detalhe}</div>}
            <div>
              <h4 className="font-semibold mb-1 text-slate-800">
                {MANUAL_EVENTOS[detail?.evento]
                  ? 'Dados da ação'
                  : 'O que enviamos à INAC (payload)'}
              </h4>
              <pre className="text-xs bg-slate-50 border rounded p-3 overflow-x-auto whitespace-pre-wrap break-all text-slate-700">
                {pretty(detail?.payload) || 'Não registrado'}
              </pre>
            </div>
            <div>
              <h4 className="font-semibold mb-1 text-slate-800">
                {MANUAL_EVENTOS[detail?.evento] ? 'Observação' : 'Resposta da INAC'}
              </h4>
              <pre className="text-xs bg-slate-50 border rounded p-3 overflow-x-auto whitespace-pre-wrap break-all text-slate-700">
                {pretty(detail?.response) || 'Sem corpo de resposta'}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

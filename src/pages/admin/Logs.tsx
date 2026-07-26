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
  api_criacao_comprador: {
    label: 'API: comprador criado',
    cls: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  api_credenciamento: {
    label: 'API: credenciamento',
    cls: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  api_reenvio_comprador: {
    label: 'API: reenvio comprador',
    cls: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  api_reenvio_participante: {
    label: 'API: reenvio participante',
    cls: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  helpdesk_credenciamento: {
    label: 'Help desk: credenciou',
    cls: 'border-teal-200 bg-teal-50 text-teal-700',
  },
  helpdesk_novo_credenciamento: {
    label: 'Help desk: NOVO credenciamento',
    cls: 'border-violet-300 bg-violet-100 text-violet-800',
  },
  helpdesk_edicao: {
    label: 'Help desk: editou',
    cls: 'border-teal-200 bg-teal-50 text-teal-700',
  },
  helpdesk_tipo_alterado: {
    label: 'Help desk: trocou tipo',
    cls: 'border-teal-200 bg-teal-50 text-teal-700',
  },
  helpdesk_qr: {
    label: 'Help desk: viu QR',
    cls: 'border-teal-200 bg-teal-50 text-teal-700',
  },
  helpdesk_qr_gerado: {
    label: 'Help desk: gerou QR',
    cls: 'border-teal-200 bg-teal-50 text-teal-700',
  },
  helpdesk_erro: {
    label: 'Help desk: falha',
    cls: 'border-rose-200 bg-rose-50 text-rose-700',
  },
}

type LogFilter = 'erros' | 'todos' | 'ok' | 'manuais' | 'helpdesk'

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

const PER_PAGE = 20

export default function AdminLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [retryingAll, setRetryingAll] = useState(false)
  const [retryingId, setRetryingId] = useState('')
  const [syncingUpgrades, setSyncingUpgrades] = useState(false)
  const [filter, setFilter] = useState<LogFilter>('erros')
  const [detail, setDetail] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const { toast } = useToast()

  const loadData = () => {
    setLoading(true)
    const params = new URLSearchParams({
      filter,
      page: String(page),
      perPage: String(PER_PAGE),
    })
    pb.send(`/backend/v1/admin/logs?${params.toString()}`)
      .then((res: any) => {
        setLogs(res.items || [])
        setTotalPages(res.totalPages || 1)
        setTotalItems(res.totalItems || 0)
        setErrorCount(res.errorCount || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page])

  const isOk = (status: number) => status >= 200 && status < 300

  // Estado de erro real do ingresso (não só do log): credenciado => nunca é erro.
  const rowIsError = (log: any) => {
    const ing = log.expand?.ingresso_id
    if (ing && !ing.inac_id && ing.status_webhook === 'erro') return true
    if (MANUAL_EVENTOS[log.evento]) return false
    if (ing?.inac_id) return false
    const sw = ing?.status_webhook
    return sw ? sw === 'erro' : !isOk(log.status)
  }

  const changeFilter = (k: LogFilter) => {
    setPage(1)
    setFilter(k)
  }

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

  // Sync de categoria (upgrade em lote GOLD->PLATINUM): PUT /edit na INAC pros
  // ingressos que já tinham inac_id e foram convertidos pela migration
  // 0034_upgrade_lote_gold_platinum (marcados com "pending-inac-edit" em origem).
  // Processa até 10 por clique — clique de novo se sobrar.
  const handleSyncUpgrades = async () => {
    setSyncingUpgrades(true)
    try {
      const res: any = await pb.send('/backend/v1/admin/sync-inac-upgrades', { method: 'POST' })
      toast({
        title: 'Sync de upgrades concluído',
        description: `${res.ok || 0} atualizado(s) na INAC, ${res.failed || 0} com erro (de ${res.tried || 0} tentados)${res.skipped?.length ? `, ${res.skipped.length} pulado(s)` : ''}.`,
      })
      loadData()
    } catch (e: any) {
      toast({ title: 'Falha', description: e.message, variant: 'destructive' })
    } finally {
      setSyncingUpgrades(false)
    }
  }

  const FILTERS: Array<[LogFilter, string]> = [
    ['erros', `Somente erros${errorCount > 0 ? ` (${errorCount})` : ''}`],
    ['todos', 'Todos'],
    ['ok', 'Somente OK'],
    ['manuais', 'Ações manuais'],
    ['helpdesk', 'Help desk'],
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Logs</h2>
          <p className="text-muted-foreground">
            {filter === 'helpdesk'
              ? 'Histórico completo das ações feitas na área /helpdesk (todas as ações, com o nome do atendente).'
              : 'Um registro por ingresso (pedido), com o status mais recente do envio ao INAC.'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleSyncUpgrades}
            disabled={syncingUpgrades}
          >
            {syncingUpgrades ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCw className="w-4 h-4" />
            )}
            Sync upgrades INAC
          </Button>
          <Button
            variant="outline"
            className="gap-2"
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
      </div>

      <div className="flex gap-2">
        {FILTERS.map(([k, label]) => (
          <Button
            key={k}
            variant={filter === k ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeFilter(k)}
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
            {logs.map((log: any) => {
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
            ) : logs.length === 0 ? (
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalItems} registro(s) · página {page} de {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
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

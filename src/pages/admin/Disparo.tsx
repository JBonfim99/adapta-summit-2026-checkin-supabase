import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Mail,
  Send,
  Loader2,
  RotateCw,
  AlertTriangle,
  Inbox,
  Users,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'
import { useRealtime } from '@/hooks/use-realtime'
import DispatchDetailDialog from '@/components/admin/DispatchDetailDialog'
import DisparoIndividual from '@/components/admin/DisparoIndividual'

interface Template {
  id: string
  name: string
}

interface Disparo {
  id: string
  nome: string
  template_id: string
  template_nome: string
  cluster: string
  total: number
  enviados: number
  erros: number
  status: string
  created: string
}

const CLUSTERS: Record<string, string> = {
  todos: 'Todos os compradores',
  pendentes: 'Compradores com ingresso pendente',
  participantes_todos: 'Todos os participantes pré-credenciados',
  participantes_recentes: 'Participantes pré-credenciados (recentes)',
  individual: 'Individual',
}

export default function AdminDispatch() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [templatesError, setTemplatesError] = useState('')

  const [templateId, setTemplateId] = useState('')
  const [cluster, setCluster] = useState('todos')
  const [nome, setNome] = useState('')
  const [dias, setDias] = useState(7)

  const [disparos, setDisparos] = useState<Disparo[]>([])

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [previewCount, setPreviewCount] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [enqueuing, setEnqueuing] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [cronInfo, setCronInfo] = useState<{ last_run: string; now: string } | null>(null)
  const [detailDisparo, setDetailDisparo] = useState<Disparo | null>(null)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewSubject, setPreviewSubject] = useState('')
  const [previewError, setPreviewError] = useState('')

  const [paginaHistorico, setPaginaHistorico] = useState(1)
  const HISTORICO_POR_PAGINA = 10

  const loadTemplates = useCallback(() => {
    setLoadingTemplates(true)
    setTemplatesError('')
    pb.send('/backend/v1/admin/sendgrid/templates', {})
      .then((res) => {
        setTemplates(res.templates || [])
        if (res.error) setTemplatesError(res.error)
      })
      .catch((e: any) => setTemplatesError(e.message || 'Falha ao carregar templates'))
      .finally(() => setLoadingTemplates(false))
  }, [])

  const loadDisparos = useCallback(() => {
    pb.collection('disparos')
      .getFullList({ sort: '-created' })
      .then((res) => setDisparos(res as unknown as Disparo[]))
      .catch(() => {})
  }, [])

  const loadHealth = useCallback(() => {
    pb.send('/backend/v1/dispatch/health', {})
      .then((res) => setCronInfo(res))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadTemplates()
    loadDisparos()
    loadHealth()
    const iv = setInterval(loadHealth, 30000)
    return () => clearInterval(iv)
  }, [loadTemplates, loadDisparos, loadHealth])

  // Acompanhamento ao vivo: o cron atualiza o registro do disparo a cada lote.
  useRealtime('disparos', () => loadDisparos())

  // Filtro de template compatível com o público do cluster:
  // precisa conter "skip-summit26" E a palavra do público (comprador/participante).
  const audience = cluster.startsWith('participantes') ? 'participantes' : 'compradores'
  const filteredTemplates = templates.filter((t) => {
    const n = (t.name || '').toLowerCase()
    if (!n.includes('skip-summit26')) return false
    return audience === 'participantes' ? n.includes('participante') : n.includes('comprador')
  })
  const templateName = templates.find((t) => t.id === templateId)?.name || templateId

  const cronAge =
    cronInfo && cronInfo.last_run
      ? Math.round((Date.parse(cronInfo.now) - Date.parse(cronInfo.last_run)) / 1000)
      : null
  const cronAtivo = cronAge !== null && cronAge < 90

  const handleDisparar = async () => {
    if (!templateId) {
      toast({ title: 'Selecione um template', variant: 'destructive' })
      return
    }
    setPreviewing(true)
    try {
      const res = await pb.send('/backend/v1/admin/dispatch/preview', {
        method: 'POST',
        body: JSON.stringify({ cluster, dias }),
      })
      setPreviewCount(res.count || 0)
      setConfirmOpen(true)
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' })
    } finally {
      setPreviewing(false)
    }
  }

  const handleConfirm = async () => {
    setEnqueuing(true)
    try {
      const res = await pb.send('/backend/v1/admin/dispatch/enqueue', {
        method: 'POST',
        body: JSON.stringify({
          cluster,
          dias,
          nome,
          template_id: templateId,
          template_nome: templateName,
        }),
      })
      setConfirmOpen(false)
      toast({
        title: 'Disparo iniciado!',
        description: `${res.enqueued} comprador(es). O envio já começou no servidor — acompanhe abaixo.`,
      })
      loadDisparos()
    } catch (e: any) {
      toast({ title: 'Erro ao enfileirar', description: e.message, variant: 'destructive' })
    } finally {
      setEnqueuing(false)
    }
  }

  const handlePreviewTemplate = async () => {
    if (!templateId) return
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewHtml('')
    setPreviewSubject('')
    try {
      const res: any = await pb.send(
        `/backend/v1/admin/sendgrid/templates/${templateId}/preview`,
        {},
      )
      if (res.error) setPreviewError(res.error)
      setPreviewHtml(res.html || '')
      setPreviewSubject(res.subject || '')
    } catch (e: any) {
      setPreviewError(e.message || 'Falha ao carregar preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleRetry = async (id: string) => {
    setRetryingId(id)
    try {
      const res = await pb.send(`/backend/v1/admin/dispatch/${id}/retry`, { method: 'POST' })
      toast({
        title: 'Reenfileirado',
        description: `${res.requeued} comprador(es) voltaram para a fila.`,
      })
      loadDisparos()
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' })
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold">Disparo de Acesso</h2>
        <p className="text-muted-foreground">
          Envia o e-mail com o link de acesso (válido por 60 dias) aos compradores via SendGrid.
        </p>
        {cronInfo && (
          <div className="mt-2">
            {cronAge === null ? (
              <Badge className="bg-slate-100 text-slate-600 border-slate-200">
                Cron: sem sinal ainda (aguarde ~1 min)
              </Badge>
            ) : cronAtivo ? (
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                Cron ativo · última execução há {cronAge}s
              </Badge>
            ) : (
              <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                Cron sem sinal há{' '}
                {cronAge >= 120 ? Math.round(cronAge / 60) + 'min' : cronAge + 's'}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Configuração do disparo */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" /> Novo disparo
          </CardTitle>
          <CardDescription>
            Escolha o template e o público. Você verá um resumo antes de confirmar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do disparo (opcional)</label>
            <Input
              placeholder="Ex: Lembrete pré-credenciamento"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <label className="text-sm font-medium">Template (SendGrid)</label>
                <button
                  type="button"
                  onClick={handlePreviewTemplate}
                  disabled={!templateId}
                  className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Ver preview do template"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              {loadingTemplates ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground h-10 px-3 border rounded-md">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando templates...
                </div>
              ) : (
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um template" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {templatesError && (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {templatesError}
                </p>
              )}
              {!loadingTemplates && !templatesError && filteredTemplates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum template "Skip-Summit26" de{' '}
                  {audience === 'participantes' ? 'participantes' : 'compradores'} encontrado.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Público (cluster)</label>
              <Select
                value={cluster}
                onValueChange={(v) => {
                  const newAud = v.startsWith('participantes') ? 'participantes' : 'compradores'
                  const oldAud = cluster.startsWith('participantes')
                    ? 'participantes'
                    : 'compradores'
                  if (newAud !== oldAud) setTemplateId('')
                  setCluster(v)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os compradores</SelectItem>
                  <SelectItem value="pendentes">Compradores com ingresso pendente</SelectItem>
                  <SelectItem value="participantes_todos">
                    Todos os participantes pré-credenciados
                  </SelectItem>
                  <SelectItem value="participantes_recentes">
                    Participantes pré-credenciados (últimos X dias)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {cluster === 'participantes_recentes' && (
            <div className="space-y-2 max-w-[240px]">
              <label className="text-sm font-medium">Pré-credenciados nos últimos (dias)</label>
              <Input
                type="number"
                min={1}
                value={dias}
                onChange={(e) => setDias(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
          )}

          <Button
            className="bg-primary gap-2"
            onClick={handleDisparar}
            disabled={previewing || !templateId}
          >
            {previewing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Disparar
          </Button>
        </CardContent>
      </Card>

      {/* Disparo individual */}
      <DisparoIndividual templates={templates} />

      {/* Histórico de disparos (ao vivo via realtime) */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Histórico de disparos</h3>
        {disparos.length === 0 ? (
          <div className="text-center py-12 bg-muted/30 rounded-xl border border-dashed text-muted-foreground">
            <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
            Nenhum disparo ainda. Os disparos aparecem aqui e atualizam sozinhos.
          </div>
        ) : (
          <div className="space-y-3">
            {disparos
              .slice(
                (paginaHistorico - 1) * HISTORICO_POR_PAGINA,
                paginaHistorico * HISTORICO_POR_PAGINA,
              )
              .map((d) => {
                const total = d.total || 0
                const enviados = d.enviados || 0
                const erros = d.erros || 0
                const restantes = Math.max(0, total - enviados - erros)
                const pct = total > 0 ? Math.round(((enviados + erros) / total) * 100) : 0
                const emAndamento = d.status === 'em_andamento'

                return (
                  <Card key={d.id} className="border shadow-sm">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold truncate">
                              {d.nome || d.template_nome}
                            </span>
                            {emAndamento ? (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> Em andamento
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                                Concluído
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {CLUSTERS[d.cluster] || d.cluster} ·{' '}
                            {new Date(d.created).toLocaleString('pt-BR')}
                          </p>
                        </div>
                        {erros > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 shrink-0"
                            onClick={() => handleRetry(d.id)}
                            disabled={retryingId === d.id}
                          >
                            {retryingId === d.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCw className="w-3 h-3" />
                            )}
                            Retentar erros ({erros})
                          </Button>
                        )}
                      </div>

                      <Progress value={pct} className="h-2" />

                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-emerald-700 font-medium">
                            {enviados}{' '}
                            <span className="text-muted-foreground font-normal">
                              de {total} enviados
                            </span>
                          </span>
                          {restantes > 0 && (
                            <span className="text-amber-600">{restantes} na fila</span>
                          )}
                          {erros > 0 && <span className="text-rose-600">{erros} com erro</span>}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-primary shrink-0"
                          onClick={() => setDetailDisparo(d)}
                        >
                          <Users className="w-4 h-4" /> Ver contatos
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
          </div>
        )}
        {disparos.length > HISTORICO_POR_PAGINA && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted-foreground">
              Página {paginaHistorico} de {Math.ceil(disparos.length / HISTORICO_POR_PAGINA)} ·{' '}
              {disparos.length} disparo(s)
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setPaginaHistorico((p) => Math.max(1, p - 1))}
                disabled={paginaHistorico <= 1}
              >
                <ChevronLeft className="w-4 h-4" /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() =>
                  setPaginaHistorico((p) =>
                    Math.min(Math.ceil(disparos.length / HISTORICO_POR_PAGINA), p + 1),
                  )
                }
                disabled={paginaHistorico >= Math.ceil(disparos.length / HISTORICO_POR_PAGINA)}
              >
                Próxima <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmação */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar disparo</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2 text-sm">
                <p>
                  Você vai disparar o e-mail de acesso para{' '}
                  <span className="font-bold text-foreground">{previewCount}</span> comprador(es).
                </p>
                <div className="rounded-lg bg-slate-50 border p-3 space-y-1">
                  {nome.trim() && (
                    <div>
                      <span className="text-muted-foreground">Nome: </span>
                      <span className="font-medium text-foreground">{nome.trim()}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Template: </span>
                    <span className="font-medium text-foreground">{templateName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Público: </span>
                    <span className="font-medium text-foreground">{CLUSTERS[cluster]}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Remetente: </span>
                    <span className="font-medium text-foreground">duvidas@adapta.org</span>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  Cada comprador recebe um link de acesso válido por 60 dias. O envio acontece em
                  segundo plano (~1000/min) e você acompanha no histórico.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={enqueuing}>
              Cancelar
            </Button>
            <Button className="bg-primary gap-2" onClick={handleConfirm} disabled={enqueuing}>
              {enqueuing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Confirmar disparo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview do template (HTML) */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Preview: {templateName}</DialogTitle>
            {previewSubject && <DialogDescription>Assunto: {previewSubject}</DialogDescription>}
          </DialogHeader>
          <div className="flex-1 min-h-0 rounded-lg border bg-white overflow-hidden">
            {previewLoading ? (
              <div className="h-full flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" /> Carregando preview...
              </div>
            ) : previewError ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-rose-600 p-6 text-center">
                <AlertTriangle className="w-6 h-6" />
                <p className="text-sm">{previewError}</p>
              </div>
            ) : previewHtml ? (
              <iframe
                title="Preview do template"
                srcDoc={previewHtml}
                sandbox=""
                className="w-full h-full border-0"
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Sem conteúdo HTML pra mostrar.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <DispatchDetailDialog
        disparo={detailDisparo}
        open={!!detailDisparo}
        onOpenChange={(o) => {
          if (!o) setDetailDisparo(null)
        }}
      />
    </div>
  )
}

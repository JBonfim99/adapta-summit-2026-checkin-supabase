import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { Mail, Send, Loader2, RotateCw, AlertTriangle } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

interface Template {
  id: string
  name: string
}

interface Stats {
  total: number
  na_fila: number
  enviando: number
  enviado: number
  erro: number
}

const CLUSTERS: Record<string, string> = {
  todos: 'Todos os compradores',
  pendentes: 'Apenas compradores com ingresso pendente',
}

export default function AdminDispatch() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [templatesError, setTemplatesError] = useState('')

  const [templateId, setTemplateId] = useState('')
  const [cluster, setCluster] = useState('todos')

  const [stats, setStats] = useState<Stats | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [previewCount, setPreviewCount] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [enqueuing, setEnqueuing] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const loadStats = useCallback(() => {
    pb.send('/backend/v1/admin/dispatch/stats', {})
      .then((res) => setStats(res))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadTemplates()
    loadStats()
    pollRef.current = setInterval(loadStats, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [loadTemplates, loadStats])

  const templateName = templates.find((t) => t.id === templateId)?.name || templateId

  const handleDisparar = async () => {
    if (!templateId) {
      toast({ title: 'Selecione um template', variant: 'destructive' })
      return
    }
    setPreviewing(true)
    try {
      const res = await pb.send('/backend/v1/admin/dispatch/preview', {
        method: 'POST',
        body: JSON.stringify({ cluster }),
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
        body: JSON.stringify({ cluster, template_id: templateId }),
      })
      setConfirmOpen(false)
      toast({
        title: 'Disparo enfileirado!',
        description: `${res.enqueued} comprador(es) na fila. O envio começa em até 1 minuto.`,
      })
      loadStats()
    } catch (e: any) {
      toast({ title: 'Erro ao enfileirar', description: e.message, variant: 'destructive' })
    } finally {
      setEnqueuing(false)
    }
  }

  const handleRetryErrors = async () => {
    setRetrying(true)
    try {
      const res = await pb.send('/backend/v1/admin/dispatch/retry-errors', { method: 'POST' })
      toast({
        title: 'Reenfileirado',
        description: `${res.requeued} comprador(es) voltaram para a fila.`,
      })
      loadStats()
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' })
    } finally {
      setRetrying(false)
    }
  }

  const statCards = [
    { label: 'Total', value: stats?.total ?? 0, cls: 'text-slate-900' },
    { label: 'Na fila', value: stats?.na_fila ?? 0, cls: 'text-amber-600' },
    { label: 'Enviando', value: stats?.enviando ?? 0, cls: 'text-blue-600' },
    { label: 'Enviado', value: stats?.enviado ?? 0, cls: 'text-emerald-600' },
    { label: 'Erro', value: stats?.erro ?? 0, cls: 'text-rose-600' },
  ]

  const inFlight = (stats?.na_fila ?? 0) + (stats?.enviando ?? 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold">Disparo de Acesso</h2>
        <p className="text-muted-foreground">
          Envia o e-mail com o link de acesso (válido por 60 dias) aos compradores via SendGrid.
        </p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Template (SendGrid)</label>
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
                    {templates.map((t) => (
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
              {!loadingTemplates && !templatesError && templates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum template dinâmico encontrado no SendGrid.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Público (cluster)</label>
              <Select value={cluster} onValueChange={setCluster}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os compradores</SelectItem>
                  <SelectItem value="pendentes">Apenas com ingresso pendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

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

      {/* Painel de status ao vivo */}
      <Card className="border-none shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Status do envio</CardTitle>
            <CardDescription>
              {inFlight > 0
                ? `${inFlight} na fila/enviando — atualiza sozinho a cada 4s.`
                : 'Fila vazia.'}
            </CardDescription>
          </div>
          {(stats?.erro ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleRetryErrors}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCw className="w-4 h-4" />
              )}
              Reenfileirar erros
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {statCards.map((s) => (
              <div key={s.label} className="rounded-xl border bg-white p-4 text-center">
                <div className={`text-3xl font-bold ${s.cls}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wide">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

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
                  segundo plano (~1000/min).
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
    </div>
  )
}

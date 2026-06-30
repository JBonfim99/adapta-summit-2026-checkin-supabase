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
import { Send, Loader2, RotateCw, Inbox, Users, Plus, Trash2 } from 'lucide-react'
import { WhatsAppIcon } from '@/components/WhatsAppIcon'
import DisparoWhatsAppIndividual from '@/components/admin/DisparoWhatsAppIndividual'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'
import { useRealtime } from '@/hooks/use-realtime'

interface DisparoWa {
  id: string
  nome: string
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
  individual: 'Individual',
}

const PRE = 'PRE' // valor do fluxo padrão (pré-credenciamento via catch webhook)

interface BcFlow {
  id: number | string
  name: string
}
interface BcField {
  id: number | string
  key: string
  type: number
}
interface MapRow {
  field_id: string
  source: string
  value: string
}

// Origens disponíveis pra alimentar as variáveis (custom fields) do fluxo.
const SOURCES: { v: string; l: string }[] = [
  { v: 'primeiro_nome', l: 'Primeiro nome' },
  { v: 'nome', l: 'Nome completo' },
  { v: 'email', l: 'E-mail' },
  { v: 'telefone', l: 'Telefone' },
  { v: 'documento', l: 'CPF / Documento' },
  { v: 'pedido_id', l: 'Número do pedido' },
  { v: 'link_acesso', l: 'Link de acesso (60d)' },
  { v: 'token', l: 'Token de acesso' },
  { v: 'static', l: 'Valor fixo' },
]

const WA_STATUS: Record<string, { label: string; cls: string }> = {
  enviado: { label: 'Enviado', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  erro: { label: 'Erro', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  na_fila: { label: 'Na fila', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  enviando: { label: 'Enviando', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
}

function ContatosDialog({
  disparo,
  open,
  onOpenChange,
}: {
  disparo: DisparoWa | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !disparo) return
    setLoading(true)
    pb.collection('compradores')
      .getList(1, 200, {
        filter: `wa_disparo_id = "${disparo.id}"`,
        sort: '-wa_enviado_em',
      })
      .then((res) => setRows(res.items))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [open, disparo])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Contatos — {disparo?.nome || 'Disparo WhatsApp'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">Nenhum contato.</p>
          ) : (
            rows.map((r) => {
              const st = WA_STATUS[r.wa_status] || {
                label: r.wa_status || '-',
                cls: 'bg-slate-100',
              }
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.nome || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                    {r.wa_status === 'erro' && r.wa_erro && (
                      <div className="text-xs text-rose-600 truncate">{r.wa_erro}</div>
                    )}
                  </div>
                  <Badge variant="outline" className={`${st.cls} shrink-0`}>
                    {st.label}
                  </Badge>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function AdminDisparoWhatsApp() {
  const { toast } = useToast()
  const [cluster, setCluster] = useState('todos')
  const [nome, setNome] = useState('')
  const [disparos, setDisparos] = useState<DisparoWa[]>([])

  const [flow, setFlow] = useState<string>(PRE)
  const [flows, setFlows] = useState<BcFlow[]>([])
  const [flowsErr, setFlowsErr] = useState<string>('')
  const [fields, setFields] = useState<BcField[]>([])
  const [mapping, setMapping] = useState<MapRow[]>([])

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [previewCount, setPreviewCount] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  const [enqueuing, setEnqueuing] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [cronInfo, setCronInfo] = useState<{ last_run: string; now: string } | null>(null)
  const [detailDisparo, setDetailDisparo] = useState<DisparoWa | null>(null)

  const loadDisparos = useCallback(() => {
    pb.collection('disparos_wa')
      .getFullList({ sort: '-created' })
      .then((res) => setDisparos(res as unknown as DisparoWa[]))
      .catch(() => {})
  }, [])

  const loadHealth = useCallback(() => {
    pb.send('/backend/v1/dispatch/health', {})
      .then((res) => setCronInfo(res))
      .catch(() => {})
  }, [])

  const loadFlows = useCallback(() => {
    pb.send('/backend/v1/admin/whatsapp/flows', {})
      .then((res) => {
        if (res.ok) {
          setFlows(res.flows || [])
          setFlowsErr('')
        } else {
          setFlows([])
          setFlowsErr(res.error || 'Não foi possível carregar os fluxos')
        }
      })
      .catch((e) => setFlowsErr(e?.message || 'Falha ao carregar fluxos'))
  }, [])

  const loadFields = useCallback(() => {
    pb.send('/backend/v1/admin/whatsapp/custom-fields', {})
      .then((res) => setFields(res.ok ? res.fields || [] : []))
      .catch(() => setFields([]))
  }, [])

  useEffect(() => {
    loadDisparos()
    loadHealth()
    loadFlows()
    loadFields()
    const iv = setInterval(loadHealth, 30000)
    return () => clearInterval(iv)
  }, [loadDisparos, loadHealth, loadFlows, loadFields])

  useRealtime('disparos_wa', () => loadDisparos())

  const cronAge =
    cronInfo && cronInfo.last_run
      ? Math.round((Date.parse(cronInfo.now) - Date.parse(cronInfo.last_run)) / 1000)
      : null
  const cronAtivo = cronAge !== null && cronAge < 90

  const handleDisparar = async () => {
    setPreviewing(true)
    try {
      const res = await pb.send('/backend/v1/admin/whatsapp/preview', {
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

  const isPre = flow === PRE
  const selectedFlowNome = isPre ? '' : flows.find((f) => String(f.id) === flow)?.name || ''
  const validMapping = mapping.filter((m) => m.field_id && m.source)

  const addRow = () => setMapping((m) => [...m, { field_id: '', source: '', value: '' }])
  const removeRow = (i: number) => setMapping((m) => m.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<MapRow>) =>
    setMapping((m) => m.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))

  const handleConfirm = async () => {
    setEnqueuing(true)
    try {
      const res = await pb.send('/backend/v1/admin/whatsapp/enqueue', {
        method: 'POST',
        body: JSON.stringify({
          cluster,
          nome,
          flow,
          flow_nome: selectedFlowNome,
          mapping: isPre ? [] : validMapping,
        }),
      })
      setConfirmOpen(false)
      toast({
        title: 'Disparo WhatsApp iniciado!',
        description: `${res.enqueued} comprador(es) na fila. O envio começa em ~1 min — acompanhe abaixo.`,
      })
      loadDisparos()
    } catch (e: any) {
      toast({ title: 'Erro ao enfileirar', description: e.message, variant: 'destructive' })
    } finally {
      setEnqueuing(false)
    }
  }

  const handleRetry = async (id: string) => {
    setRetryingId(id)
    try {
      const res = await pb.send(`/backend/v1/admin/whatsapp/${id}/retry`, { method: 'POST' })
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
        <h2 className="text-2xl font-bold">Disparo WhatsApp</h2>
        <p className="text-muted-foreground">
          Envia o link de acesso (válido por 60 dias) aos compradores via BotConversa — um a um.
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

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <WhatsAppIcon className="w-5 h-5 text-[#25D366]" /> Novo disparo
          </CardTitle>
          <CardDescription>
            A mensagem é configurada no BotConversa. Enviamos por comprador: nome, e-mail e o token
            de acesso.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do disparo (opcional)</label>
            <Input
              placeholder="Ex: WhatsApp — lembrete de acesso"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>

          <div className="space-y-2 max-w-md">
            <label className="text-sm font-medium">Público (cluster)</label>
            <Select value={cluster} onValueChange={setCluster}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os compradores</SelectItem>
                <SelectItem value="pendentes">Compradores com ingresso pendente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 max-w-md">
            <label className="text-sm font-medium">Fluxo</label>
            <Select
              value={flow}
              onValueChange={(v) => {
                setFlow(v)
                if (v === PRE) setMapping([])
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRE}>Pré-credenciamento (padrão)</SelectItem>
                {flows.map((f) => (
                  <SelectItem key={String(f.id)} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {flowsErr && <p className="text-xs text-amber-600">Fluxos indisponíveis: {flowsErr}</p>}
            <p className="text-xs text-muted-foreground">
              {isPre
                ? 'Envia o link de acesso (token de 60 dias) pela automação padrão.'
                : 'Cria/atualiza o contato no BotConversa e dispara este fluxo.'}
            </p>
          </div>

          {!isPre && (
            <div className="space-y-3 rounded-lg border bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Mapeamento de variáveis</p>
                  <p className="text-xs text-muted-foreground">
                    Preencha as variáveis (custom fields) que esse fluxo usa. Se não usar nenhuma,
                    pode disparar sem mapear.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1 shrink-0"
                  onClick={addRow}
                >
                  <Plus className="w-3 h-3" /> Variável
                </Button>
              </div>

              {mapping.length > 0 && (
                <div className="space-y-2">
                  {mapping.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select
                        value={row.field_id}
                        onValueChange={(v) => updateRow(i, { field_id: v })}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Variável" />
                        </SelectTrigger>
                        <SelectContent>
                          {fields.length === 0 ? (
                            <SelectItem value="__none" disabled>
                              Nenhum custom field
                            </SelectItem>
                          ) : (
                            fields.map((f) => (
                              <SelectItem key={String(f.id)} value={String(f.id)}>
                                {f.key}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground text-xs shrink-0">←</span>
                      <Select value={row.source} onValueChange={(v) => updateRow(i, { source: v })}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Origem" />
                        </SelectTrigger>
                        <SelectContent>
                          {SOURCES.map((s) => (
                            <SelectItem key={s.v} value={s.v}>
                              {s.l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {row.source === 'static' && (
                        <Input
                          className="flex-1"
                          placeholder="Valor fixo"
                          value={row.value}
                          onChange={(e) => updateRow(i, { value: e.target.value })}
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-rose-600"
                        onClick={() => removeRow(i)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Button
            className="bg-[#25D366] hover:bg-[#1ebe5a] text-white gap-2"
            onClick={handleDisparar}
            disabled={previewing}
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

      <DisparoWhatsAppIndividual onSent={loadDisparos} />

      <div>
        <h3 className="text-lg font-semibold mb-3">Histórico de disparos</h3>
        {disparos.length === 0 ? (
          <div className="text-center py-12 bg-muted/30 rounded-xl border border-dashed text-muted-foreground">
            <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
            Nenhum disparo ainda. Os disparos aparecem aqui e atualizam sozinhos.
          </div>
        ) : (
          <div className="space-y-3">
            {disparos.map((d) => {
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
                            {d.nome || 'Disparo WhatsApp'}
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
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar disparo WhatsApp</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2 text-sm">
                <p>
                  Você vai disparar o WhatsApp de acesso para{' '}
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
                    <span className="text-muted-foreground">Público: </span>
                    <span className="font-medium text-foreground">{CLUSTERS[cluster]}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Canal: </span>
                    <span className="font-medium text-foreground">BotConversa (WhatsApp)</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fluxo: </span>
                    <span className="font-medium text-foreground">
                      {isPre ? 'Pré-credenciamento (padrão)' : selectedFlowNome || flow}
                    </span>
                  </div>
                  {!isPre && validMapping.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Variáveis mapeadas: </span>
                      <span className="font-medium text-foreground">{validMapping.length}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Custo por mensagem: </span>
                    <span className="font-medium text-foreground">R$ 0,50 (marketing)</span>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <span className="text-sm font-medium text-emerald-800">Custo total estimado</span>
                  <span className="text-xl font-bold text-emerald-700">
                    {(previewCount * 0.5).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {isPre
                    ? 'Cada comprador recebe um link de acesso válido por 60 dias. '
                    : 'O contato é criado/atualizado no BotConversa e recebe o fluxo selecionado. '}
                  O envio é um a um, em segundo plano, e você acompanha no histórico. O custo é
                  estimado: {previewCount} × R$ 0,50.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={enqueuing}>
              Cancelar
            </Button>
            <Button
              className="bg-[#25D366] hover:bg-[#1ebe5a] text-white gap-2"
              onClick={handleConfirm}
              disabled={enqueuing}
            >
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

      <ContatosDialog
        disparo={detailDisparo}
        open={!!detailDisparo}
        onOpenChange={(o) => {
          if (!o) setDetailDisparo(null)
        }}
      />
    </div>
  )
}

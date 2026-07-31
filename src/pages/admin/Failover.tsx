import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Power, RefreshCw, ShieldOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/backend/client'

interface FailoverStatus {
  health: {
    mode: 'standby' | 'active' | 'maintenance'
    external_effects_enabled: boolean
    last_sync_poll_at: string | null
    last_sync_event_at: string | null
    last_reconciled_at: string | null
    sync_outbox_backlog: number
    bootstrap_state: string
    last_sync_error: string | null
    lag_seconds: number | null
    failed_events: number
    pending_events: number
  }
  bootstrap: {
    id: string
    state: string
    counts: Record<string, number>
    current_collection: string | null
    error: string | null
  } | null
  provider_modes: Record<'sendgrid' | 'botconversa' | 'inac', string>
  worker: { configured: boolean; paused: boolean }
  readiness: {
    sync_ready: boolean
    can_activate: boolean
    can_enable_external_effects: boolean
  }
  audit: Array<{
    id: number
    action: string
    reason: string
    created_at: string
  }>
}

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('pt-BR') : 'Ainda não registrado'

export default function AdminFailover() {
  const { toast } = useToast()
  const [data, setData] = useState<FailoverStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [activateOpen, setActivateOpen] = useState(false)
  const [effectsOpen, setEffectsOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await pb.send('/backend/v1/admin/system/failover', { method: 'GET' }))
    } catch (error: any) {
      toast({
        title: 'Falha ao consultar failover',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const run = async (path: string, body: Record<string, unknown>, success: string) => {
    setWorking(true)
    try {
      await pb.send(path, { method: 'POST', body })
      toast({ title: success })
      setActivateOpen(false)
      setEffectsOpen(false)
      setReason('')
      setConfirmation('')
      await load()
    } catch (error: any) {
      toast({ title: 'Operação bloqueada', description: error.message, variant: 'destructive' })
    } finally {
      setWorking(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const health = data.health
  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Sistema / Failover</h2>
          <p className="text-muted-foreground">
            Controle separado da sincronização e das comunicações externas.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modo do sistema</CardTitle>
            <CardDescription>O fallback só atende operações quando está ativo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant={health.mode === 'active' ? 'destructive' : 'secondary'}>
              {health.mode}
            </Badge>
            {health.mode === 'standby' ? (
              <Button
                className="w-full gap-2"
                disabled={!data.readiness.can_activate}
                onClick={() => setActivateOpen(true)}
              >
                <Power className="h-4 w-4" />
                Ativar fallback
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                disabled={working || health.external_effects_enabled}
                onClick={() =>
                  void run(
                    '/backend/v1/admin/system/mode',
                    { mode: 'standby', reason: 'Retorno operacional ao Skip' },
                    'Supabase voltou ao standby',
                  )
                }
              >
                Voltar ao standby
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comunicações externas</CardTitle>
            <CardDescription>SendGrid, BotConversa e INAC usam esta trava única.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge variant={health.external_effects_enabled ? 'destructive' : 'secondary'}>
              {health.external_effects_enabled ? 'habilitadas' : 'bloqueadas'}
            </Badge>
            {health.external_effects_enabled ? (
              <Button
                variant="destructive"
                className="w-full gap-2"
                disabled={working}
                onClick={() =>
                  void run(
                    '/backend/v1/admin/system/external-effects',
                    { enabled: false, reason: 'Desativação de emergência pelo Admin' },
                    'Comunicações desabilitadas',
                  )
                }
              >
                <ShieldOff className="h-4 w-4" />
                Desabilitar comunicações
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={!data.readiness.can_enable_external_effects}
                onClick={() => setEffectsOpen(true)}
              >
                Habilitar comunicações
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prontidão</CardTitle>
            <CardDescription>Pré-condições verificadas no servidor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              {data.readiness.sync_ready ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              Sincronização {data.readiness.sync_ready ? 'pronta' : 'não pronta'}
            </p>
            <p>
              Bootstrap: <strong>{health.bootstrap_state}</strong>
            </p>
            <p>
              Backlog do Skip: <strong>{health.sync_outbox_backlog}</strong>
            </p>
            <p>
              Eventos pendentes: <strong>{health.pending_events}</strong>
            </p>
            <p>
              Eventos com erro: <strong>{health.failed_events}</strong>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saúde da sincronização</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Última consulta</span>
            <p>{dateTime(health.last_sync_poll_at)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Último evento</span>
            <p>{dateTime(health.last_sync_event_at)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Última reconciliação</span>
            <p>{dateTime(health.last_reconciled_at)}</p>
          </div>
          {health.last_sync_error && (
            <div className="md:col-span-3 rounded-md bg-rose-50 p-3 text-rose-700">
              {health.last_sync_error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provedores</CardTitle>
          <CardDescription>Os modos são somente leitura; nenhum segredo é exibido.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {Object.entries(data.provider_modes).map(([provider, mode]) => (
            <div key={provider} className="rounded-md border px-3 py-2 text-sm">
              <strong className="capitalize">{provider}</strong>{' '}
              <Badge variant={mode === 'live' ? 'destructive' : 'secondary'}>{mode}</Badge>
            </div>
          ))}
          <div className="rounded-md border px-3 py-2 text-sm">
            Worker <Badge variant="secondary">{data.worker.paused ? 'pausado' : 'ativo'}</Badge>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar o fallback Supabase?</AlertDialogTitle>
            <AlertDialogDescription>
              A ativação não altera o Skip. As comunicações continuarão desabilitadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="Motivo da ativação"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Input
            placeholder="Digite ATIVAR FALLBACK"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={working || !reason.trim() || confirmation !== 'ATIVAR FALLBACK'}
              onClick={() =>
                void run(
                  '/backend/v1/admin/system/mode',
                  { mode: 'active', reason, confirmation },
                  'Fallback Supabase ativado; comunicações seguem bloqueadas',
                )
              }
            >
              Confirmar ativação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={effectsOpen} onOpenChange={setEffectsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Habilitar comunicações reais?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta é uma etapa separada do failover. Os provedores poderão contatar clientes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="Motivo da liberação"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Input
            placeholder="Digite HABILITAR COMUNICACOES"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={working || !reason.trim() || confirmation !== 'HABILITAR COMUNICACOES'}
              onClick={() =>
                void run(
                  '/backend/v1/admin/system/external-effects',
                  { enabled: true, reason, confirmation },
                  'Comunicações externas habilitadas',
                )
              }
            >
              Habilitar comunicações
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

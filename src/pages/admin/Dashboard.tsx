import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Ticket,
  Users,
  CheckCircle,
  AlertCircle,
  Loader2,
  RotateCw,
  ShoppingBag,
  Clock,
} from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import pb from '@/lib/pocketbase/client'

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

// Formata duração em ms como "2d 3h", "5h 12min", "40min" ou "30s".
const fmtDur = (ms: number) => {
  if (!ms || ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}min`
  if (m > 0) return `${m}min`
  return `${s}s`
}

function HourlyChart({ serie }: { serie: { hora: string; total: number }[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null)
  const max = Math.max(1, ...serie.map((x) => x.total))
  const hasData = serie.some((x) => x.total > 0)
  if (!hasData) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Sem dados ainda.</p>
  }
  const two = (n: number) => String(n).padStart(2, '0')
  const periodo = (iso: string) => {
    const dt = new Date(iso)
    const ini = `${two(dt.getHours())}:00`
    const fim = `${two((dt.getHours() + 1) % 24)}:00`
    return `${two(dt.getDate())}/${two(dt.getMonth() + 1)} · ${ini}–${fim}`
  }
  const move = (e: React.MouseEvent, i: number) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, i })
  }
  const active = tip ? serie[tip.i] : null
  return (
    <div ref={wrapRef} className="relative" onMouseLeave={() => setTip(null)}>
      {tip && active && (
        <div
          className="pointer-events-none absolute z-20 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg whitespace-nowrap"
          style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, calc(-100% - 10px))' }}
        >
          <div className="font-semibold">
            {active.total} credenciamento{active.total === 1 ? '' : 's'}
          </div>
          <div className="text-slate-300">{periodo(active.hora)}</div>
        </div>
      )}
      <div className="flex items-end gap-1 h-52 overflow-x-auto pb-2">
        {serie.map((x, i) => {
          const dt = new Date(x.hora)
          const hh = dt.getHours()
          const showLabel = hh % 6 === 0
          const label = hh === 0 ? `${two(dt.getDate())}/${two(dt.getMonth() + 1)}` : `${two(hh)}h`
          const isActive = tip?.i === i
          return (
            <div
              key={x.hora}
              className="flex-1 min-w-[10px] flex flex-col items-center gap-1 cursor-pointer"
              onMouseMove={(e) => move(e, i)}
            >
              <div className="w-full flex items-end" style={{ height: '150px' }}>
                <div
                  className={`w-full rounded-t transition-colors duration-150 ${
                    isActive ? 'bg-emerald-600' : 'bg-emerald-500/80'
                  }`}
                  style={{
                    height: `${(x.total / max) * 100}%`,
                    minHeight: x.total > 0 ? '2px' : '0',
                  }}
                />
              </div>
              <div className="text-[9px] text-muted-foreground h-3 leading-3">
                {showLabel ? label : ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    compradores_total: 0,
    total: 0,
    preenchidos: 0,
    pendentes: 0,
    erros: 0,
    platinum: { total: 0, preenchidos: 0, pendentes: 0 },
    gold: { total: 0, preenchidos: 0, pendentes: 0 },
    activity: [] as any[],
    por_hora: [] as { hora: string; total: number }[],
    tempo_medio_ms: 0,
    tempo_mediana_ms: 0,
    credenciados_com_tempo: 0,
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadStats = () => {
    setRefreshing(true)
    return pb
      .send('/backend/v1/admin/stats', { method: 'GET' })
      .then((res) => setStats(res))
      .catch(() => {})
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }

  useEffect(() => {
    loadStats()
  }, [])

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-muted-foreground">Visão geral do evento e dos ingressos.</p>
        </div>
        <Button
          variant="outline"
          className="gap-2 shrink-0"
          onClick={loadStats}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RotateCw className="w-4 h-4" />
          )}
          Atualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Compradores</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.compradores_total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Ingressos</CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Credenciados</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{stats.preenchidos}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
            <Users className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.pendentes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Erros Webhook</CardTitle>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">{stats.erros}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Taxa geral de pré-credenciamento</CardTitle>
          <CheckCircle className="h-4 w-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between mb-2">
            <span className="text-3xl font-bold text-emerald-600">
              {pct(stats.preenchidos, stats.total)}%
            </span>
            <span className="text-sm text-muted-foreground">
              {stats.preenchidos} de {stats.total} ingressos
            </span>
          </div>
          <Progress value={pct(stats.preenchidos, stats.total)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingressos PLATINUM</CardTitle>
            <Ticket className="h-4 w-4 text-slate-700" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-800">{stats.platinum?.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.platinum?.preenchidos || 0} credenciados • {stats.platinum?.pendentes || 0}{' '}
              pendentes
            </p>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Taxa de pré-credenciamento</span>
                <span className="font-semibold text-slate-800">
                  {pct(stats.platinum?.preenchidos || 0, stats.platinum?.total || 0)}%
                </span>
              </div>
              <Progress value={pct(stats.platinum?.preenchidos || 0, stats.platinum?.total || 0)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingressos GOLD</CardTitle>
            <Users className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.gold?.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.gold?.preenchidos || 0} credenciados • {stats.gold?.pendentes || 0} pendentes
            </p>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Taxa de pré-credenciamento</span>
                <span className="font-semibold text-amber-600">
                  {pct(stats.gold?.preenchidos || 0, stats.gold?.total || 0)}%
                </span>
              </div>
              <Progress value={pct(stats.gold?.preenchidos || 0, stats.gold?.total || 0)} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tempo até o credenciamento */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tempo médio até o credenciamento</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{fmtDur(stats.tempo_medio_ms)}</div>
          <p className="text-xs text-muted-foreground mt-1">
            mediana {fmtDur(stats.tempo_mediana_ms)} · da criação do ingresso até o preenchimento
            (base de {stats.credenciados_com_tempo})
          </p>
        </CardContent>
      </Card>

      {/* Credenciamentos por hora */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Credenciamentos por hora</CardTitle>
          <p className="text-xs text-muted-foreground">Últimas 48 horas com atividade.</p>
        </CardHeader>
        <CardContent>
          <HourlyChart serie={stats.por_hora || []} />
        </CardContent>
      </Card>
    </div>
  )
}

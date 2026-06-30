import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCcw, Users, Building2, Sparkles, TrendingUp } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { ROLES, REVENUE, EMPLOYEES } from '@/lib/form-options'

interface Insights {
  total: number
  perfil: { empresa: number; profissional: number }
  por_tipo: { GOLD: number; PLATINUM: number }
  cargo: Record<string, number>
  segmento: Record<string, number>
  faturamento: Record<string, number>
  funcionarios: Record<string, number>
  ia: {
    uso_dist: number[]
    prof_dist: number[]
    uso_avg: number
    prof_avg: number
    matriz: number[][]
    por_tipo: {
      GOLD: { uso_avg: number; prof_avg: number }
      PLATINUM: { uso_avg: number; prof_avg: number }
    }
  }
  ferramentas: Record<string, number>
  sem_ferramenta: number
  desafios: Record<string, number>
  por_dia: Record<string, number>
}

const USO_LABELS = ['Nunca / Ninguém', 'Poucos', 'Metade', 'Maioria', 'Todos / Sempre']
const PROF_LABELS = ['Como Google', 'Básico', 'Intermediário', 'Avançado', 'Nativo de IA']

function BarRow({
  label,
  value,
  max,
  color = 'bg-primary',
}: {
  label: string
  value: number
  max: number
  color?: string
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-44 shrink-0 text-sm text-slate-600 truncate" title={label}>
        {label}
      </div>
      <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
        <div
          className={`${color} h-full rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-8 shrink-0 text-sm font-semibold text-right tabular-nums">{value}</div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Icon className="w-4 h-4" />
          <span className="text-sm">{label}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export default function InsightsResumo() {
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    pb.send('/backend/v1/admin/insights', {})
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Não foi possível carregar os insights.{' '}
        <button className="text-primary underline" onClick={load}>
          Tentar de novo
        </button>
      </div>
    )
  }

  const total = data.total
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

  const orderedDict = (dict: Record<string, number>, order: string[]) =>
    order.map((k) => ({ k, v: dict[k] || 0 })).filter((x) => x.v > 0)
  const sortedDict = (dict: Record<string, number>, top?: number) => {
    const arr = Object.keys(dict).map((k) => ({ k, v: dict[k] }))
    arr.sort((a, b) => b.v - a.v)
    return top ? arr.slice(0, top) : arr
  }

  const cargoRows = orderedDict(data.cargo, ROLES)
  const fatRows = orderedDict(data.faturamento, REVENUE)
  const funcRows = orderedDict(data.funcionarios, EMPLOYEES)
  const segRows = sortedDict(data.segmento, 12)
  const ferrRows = sortedDict(data.ferramentas)
  const desRows = sortedDict(data.desafios)

  const maxCargo = Math.max(1, ...cargoRows.map((x) => x.v))
  const maxFat = Math.max(1, ...fatRows.map((x) => x.v))
  const maxFunc = Math.max(1, ...funcRows.map((x) => x.v))
  const maxSeg = Math.max(1, ...segRows.map((x) => x.v))
  const maxFerr = Math.max(1, ...ferrRows.map((x) => x.v))
  const maxDes = Math.max(1, ...desRows.map((x) => x.v))
  const maxUso = Math.max(1, ...data.ia.uso_dist)
  const maxProf = Math.max(1, ...data.ia.prof_dist)

  const dias = Object.keys(data.por_dia)
    .sort()
    .map((d) => ({ d, v: data.por_dia[d] }))
  const maxDia = Math.max(1, ...dias.map((x) => x.v))
  const ddmm = (iso: string) => {
    const [, m, day] = iso.split('-')
    return `${day}/${m}`
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Perfil e maturidade em IA dos {total} pré-credenciados.
        </p>
        <Button variant="outline" size="sm" className="gap-2" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCcw className="w-4 h-4" />
          )}
          Atualizar
        </Button>
      </div>

      {/* Visão geral */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Pré-credenciados" value={String(total)} />
        <StatCard
          icon={Building2}
          label="Empresa vs Profissional"
          value={`${pct(data.perfil.empresa)}% / ${pct(data.perfil.profissional)}%`}
          sub={`${data.perfil.empresa} empresa · ${data.perfil.profissional} profissional`}
        />
        <StatCard
          icon={Sparkles}
          label="Maturidade IA (média)"
          value={`${data.ia.uso_avg.toFixed(1)} · ${data.ia.prof_avg.toFixed(1)}`}
          sub="uso diário · profundidade (de 5)"
        />
        <StatCard
          icon={TrendingUp}
          label="GOLD vs PLATINUM"
          value={`${data.por_tipo.GOLD} / ${data.por_tipo.PLATINUM}`}
          sub="credenciados por tipo"
        />
      </div>

      {/* Maturidade em IA */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Maturidade em IA</CardTitle>
          <CardDescription>
            Distribuição das duas escalas (1 a 5) e onde o público se concentra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h4 className="font-semibold text-sm">Quantas pessoas usam IA diariamente</h4>
                <span className="text-sm text-muted-foreground">
                  média{' '}
                  <span className="font-bold text-foreground">{data.ia.uso_avg.toFixed(1)}</span>
                </span>
              </div>
              <div className="space-y-2">
                {data.ia.uso_dist.map((v, i) => (
                  <BarRow key={i} label={`${i + 1} · ${USO_LABELS[i]}`} value={v} max={maxUso} />
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h4 className="font-semibold text-sm">Profundidade do uso de IA</h4>
                <span className="text-sm text-muted-foreground">
                  média{' '}
                  <span className="font-bold text-foreground">{data.ia.prof_avg.toFixed(1)}</span>
                </span>
              </div>
              <div className="space-y-2">
                {data.ia.prof_dist.map((v, i) => (
                  <BarRow
                    key={i}
                    label={`${i + 1} · ${PROF_LABELS[i]}`}
                    value={v}
                    max={maxProf}
                    color="bg-accent"
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Médias por tipo */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="rounded-lg border bg-amber-50/50 p-4">
              <div className="text-sm font-semibold text-amber-700 mb-1">GOLD</div>
              <div className="text-sm text-slate-600">
                Uso <span className="font-bold">{data.ia.por_tipo.GOLD.uso_avg.toFixed(1)}</span> ·
                Profundidade{' '}
                <span className="font-bold">{data.ia.por_tipo.GOLD.prof_avg.toFixed(1)}</span>
              </div>
            </div>
            <div className="rounded-lg border bg-slate-100/70 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-1">PLATINUM</div>
              <div className="text-sm text-slate-600">
                Uso{' '}
                <span className="font-bold">{data.ia.por_tipo.PLATINUM.uso_avg.toFixed(1)}</span> ·
                Profundidade{' '}
                <span className="font-bold">{data.ia.por_tipo.PLATINUM.prof_avg.toFixed(1)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Perfil do público */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Segmentos (top 12)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {segRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              segRows.map((x) => <BarRow key={x.k} label={x.k} value={x.v} max={maxSeg} />)
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Cargo (perfil empresa)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cargoRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              cargoRows.map((x) => <BarRow key={x.k} label={x.k} value={x.v} max={maxCargo} />)
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Faturamento anual (empresa)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {fatRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              fatRows.map((x) => (
                <BarRow key={x.k} label={x.k} value={x.v} max={maxFat} color="bg-emerald-500" />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Nº de funcionários (empresa)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {funcRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              funcRows.map((x) => (
                <BarRow key={x.k} label={x.k} value={x.v} max={maxFunc} color="bg-emerald-500" />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ferramentas e desafios */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Ferramentas de IA mais citadas</CardTitle>
            <CardDescription>
              Detecção por palavra-chave no campo aberto.
              {data.sem_ferramenta > 0 && ` ${data.sem_ferramenta} não informaram.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ferrRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              ferrRows.map((x) => (
                <BarRow key={x.k} label={x.k} value={x.v} max={maxFerr} color="bg-indigo-500" />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Principais desafios com IA</CardTitle>
            <CardDescription>Temas detectados por palavra-chave no campo aberto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {desRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
            ) : (
              desRows.map((x) => (
                <BarRow key={x.k} label={x.k} value={x.v} max={maxDes} color="bg-rose-400" />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Evolução por dia */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Pré-credenciamentos por dia</CardTitle>
        </CardHeader>
        <CardContent>
          {dias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
          ) : (
            <div className="flex items-end gap-2 h-44 overflow-x-auto">
              {dias.map((x) => (
                <div key={x.d} className="flex-1 min-w-[36px] flex flex-col items-center gap-1">
                  <div className="text-xs font-semibold">{x.v}</div>
                  <div className="w-full flex items-end" style={{ height: '120px' }}>
                    <div
                      className="w-full bg-primary/80 rounded-t transition-all duration-500"
                      style={{ height: `${(x.v / maxDia) * 100}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground">{ddmm(x.d)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

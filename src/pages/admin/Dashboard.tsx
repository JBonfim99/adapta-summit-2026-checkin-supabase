import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Ticket, Users, CheckCircle, AlertCircle, Loader2, RotateCw } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import pb from '@/lib/pocketbase/client'

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    total: 0,
    preenchidos: 0,
    pendentes: 0,
    erros: 0,
    platinum: { total: 0, preenchidos: 0, pendentes: 0 },
    gold: { total: 0, preenchidos: 0, pendentes: 0 },
    activity: [] as any[],
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
    </div>
  )
}

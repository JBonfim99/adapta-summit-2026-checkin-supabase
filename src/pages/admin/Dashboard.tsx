import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Ticket, Users, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import pb from '@/lib/pocketbase/client'

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

  useEffect(() => {
    pb.send('/backend/v1/admin/stats', { method: 'GET' })
      .then((res) => {
        setStats(res)
        setLoading(false)
      })
      .catch(() => setLoading(false))
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
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted-foreground">Visão geral do evento e dos ingressos.</p>
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

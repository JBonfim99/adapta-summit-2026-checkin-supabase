import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Ticket as TicketIcon, Percent, Activity } from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart'
import pb from '@/lib/pocketbase/client'

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    pb.send('/backend/v1/admin/stats', { method: 'GET' }).then(setStats)
  }, [])

  if (!stats)
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse">
        Carregando métricas...
      </div>
    )

  const fillRate = stats.total ? Math.round((stats.preenchidos / stats.total) * 100) : 0

  const chartData = [
    {
      name: 'VIP',
      preenchidos: stats.vip.preenchidos,
      pendentes: stats.vip.pendentes,
    },
    {
      name: 'Standard',
      preenchidos: stats.standard.preenchidos,
      pendentes: stats.standard.pendentes,
    },
  ]

  const chartConfig = {
    preenchidos: { label: 'Preenchidos', color: 'hsl(var(--chart-2))' },
    pendentes: { label: 'Pendentes', color: 'hsl(var(--chart-3))' },
  }

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard Administrativo</h2>
        <p className="text-muted-foreground">Visão geral do progresso de credenciamento.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Importado</CardTitle>
            <TicketIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Preenchidos</CardTitle>
            <Users className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{stats.preenchidos}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
            <Activity className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{stats.pendentes}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Preenchimento</CardTitle>
            <Percent className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-accent">{fillRate}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-sm">
          <CardHeader>
            <CardTitle>Status por Tipo de Ingresso</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis
                    dataKey="name"
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}`}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="preenchidos"
                    fill="var(--color-preenchidos)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar dataKey="pendentes" fill="var(--color-pendentes)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="col-span-3 shadow-sm">
          <CardHeader>
            <CardTitle>Atividade Recente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {stats.activity.map((p: any) => (
                <div key={p.id} className="flex items-center">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{p.nome}</p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      Preencheu o ingresso {p.ingresso_id}
                    </p>
                  </div>
                </div>
              ))}
              {stats.activity.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhuma atividade recente.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

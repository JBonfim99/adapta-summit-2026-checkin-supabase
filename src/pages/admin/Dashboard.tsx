import { useApp } from '@/contexts/app-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Ticket as TicketIcon, Percent, Activity } from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart'

export default function AdminDashboard() {
  const { tickets, participants } = useApp()

  const totalTickets = tickets.length
  const filledTickets = tickets.filter((t) => t.status === 'filled').length
  const pendingTickets = totalTickets - filledTickets
  const fillRate = totalTickets ? Math.round((filledTickets / totalTickets) * 100) : 0

  const chartData = [
    {
      name: 'VIP',
      preenchidos: tickets.filter((t) => t.type === 'VIP' && t.status === 'filled').length,
      pendentes: tickets.filter((t) => t.type === 'VIP' && t.status === 'pending').length,
    },
    {
      name: 'Standard',
      preenchidos: tickets.filter((t) => t.type === 'Standard' && t.status === 'filled').length,
      pendentes: tickets.filter((t) => t.type === 'Standard' && t.status === 'pending').length,
    },
  ]

  const chartConfig = {
    preenchidos: { label: 'Preenchidos', color: 'hsl(var(--chart-2))' },
    pendentes: { label: 'Pendentes', color: 'hsl(var(--chart-3))' },
  }

  return (
    <div className="space-y-8">
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
            <div className="text-2xl font-bold">{totalTickets}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Preenchidos</CardTitle>
            <Users className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{filledTickets}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendentes</CardTitle>
            <Activity className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{pendingTickets}</div>
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
              {participants
                .slice(-5)
                .reverse()
                .map((p) => (
                  <div key={p.id} className="flex items-center">
                    <div className="ml-4 space-y-1">
                      <p className="text-sm font-medium leading-none">{p.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Preencheu o ingresso {p.ticketId}
                      </p>
                    </div>
                  </div>
                ))}
              {participants.length === 0 && (
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

import { useState } from 'react'
import { useApp } from '@/contexts/app-context'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Download, Mail } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'

export default function AdminParticipants() {
  const { tickets, participants } = useApp()
  const [search, setSearch] = useState('')

  const enrichedData = tickets
    .map((t) => {
      const p = participants.find((part) => part.ticketId === t.id)
      return { ...t, participant: p }
    })
    .filter((item) => {
      const term = search.toLowerCase()
      return (
        item.buyerEmail.toLowerCase().includes(term) ||
        item.id.toLowerCase().includes(term) ||
        item.participant?.name.toLowerCase().includes(term)
      )
    })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Participantes</h2>
          <p className="text-muted-foreground">Visualize e filtre todos os credenciamentos.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Mail className="w-4 h-4" /> Cobrar Pendentes
          </Button>
          <Button className="bg-primary gap-2">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email ou pedido..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Ingresso</TableHead>
              <TableHead>Comprador</TableHead>
              <TableHead>Participante</TableHead>
              <TableHead>Empresa / Cargo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {enrichedData.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  {row.id}
                  <div className="text-xs text-muted-foreground">{row.type}</div>
                </TableCell>
                <TableCell>{row.buyerEmail}</TableCell>
                <TableCell>
                  {row.participant ? (
                    <div>
                      <div className="font-medium">{row.participant.name}</div>
                      <div className="text-xs text-muted-foreground">{row.participant.email}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.participant ? (
                    <div>
                      <div>{row.participant.company}</div>
                      <div className="text-xs text-muted-foreground">{row.participant.role}</div>
                    </div>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
              </TableRow>
            ))}
            {enrichedData.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhum registro encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

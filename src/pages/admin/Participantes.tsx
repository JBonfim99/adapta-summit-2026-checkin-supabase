import { useState, useEffect } from 'react'
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
import { Search, Download, RefreshCcw } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import pb from '@/lib/pocketbase/client'

export default function AdminParticipants() {
  const [data, setData] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = () => {
    setLoading(true)
    pb.collection('ingressos')
      .getFullList({ expand: 'comprador_id,participante_id', sort: '-created' })
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredData = data.filter((item) => {
    const term = search.toLowerCase()
    const compEmail = item.expand?.comprador_id?.email || ''
    const partName = item.expand?.participante_id?.nome_completo || ''
    return (
      compEmail.toLowerCase().includes(term) ||
      item.pedido_id.toLowerCase().includes(term) ||
      partName.toLowerCase().includes(term)
    )
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Participantes</h2>
          <p className="text-muted-foreground">Visualize e filtre todos os credenciamentos.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={loadData}>
            <RefreshCcw className="w-4 h-4" /> Atualizar
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
            className="pl-9 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Ingresso / Pedido</TableHead>
              <TableHead>Comprador</TableHead>
              <TableHead>Participante</TableHead>
              <TableHead>Empresa / Cargo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filteredData.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <div className="font-mono text-sm">{row.pedido_id}</div>
                    <div className="text-xs text-muted-foreground">{row.tipo_ingresso}</div>
                  </TableCell>
                  <TableCell className="text-sm">{row.expand?.comprador_id?.email}</TableCell>
                  <TableCell>
                    {row.expand?.participante_id ? (
                      <div>
                        <div className="font-medium text-sm">
                          {row.expand.participante_id.nome_completo}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.expand.participante_id.email}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm italic">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.expand?.participante_id ? (
                      <div>
                        <div className="text-sm">{row.expand.participante_id.nome_empresa}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.expand.participante_id.cargo}
                        </div>
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
            {!loading && filteredData.length === 0 && (
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

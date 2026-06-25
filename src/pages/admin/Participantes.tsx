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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { useToast } from '@/hooks/use-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

export default function AdminParticipants() {
  const [data, setData] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 10

  const [selectedParticipant, setSelectedParticipant] = useState<any>(null)

  const loadData = () => {
    setLoading(true)
    let filterStr = ''
    if (search) {
      const s = search.replace(/"/g, '')
      filterStr = `comprador_id.email ~ "${s}" || pedido_id ~ "${s}" || participante_id.nome_completo ~ "${s}" || participante_id.email ~ "${s}"`
    }

    pb.collection('ingressos')
      .getList(page, limit, {
        expand: 'comprador_id,participante_id',
        sort: '-created',
        filter: filterStr,
      })
      .then((res) => {
        setData(res.items)
        setTotalPages(res.totalPages || 1)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [page, search])

  const handleExportCSV = async () => {
    try {
      let filterStr = ''
      if (search) {
        const s = search.replace(/"/g, '')
        filterStr = `comprador_id.email ~ "${s}" || pedido_id ~ "${s}" || participante_id.nome_completo ~ "${s}" || participante_id.email ~ "${s}"`
      }

      const allTickets = await pb
        .collection('ingressos')
        .getFullList({
          expand: 'comprador_id,participante_id',
          sort: '-created',
          filter: filterStr,
        })

      const csvContent = [
        [
          'Pedido',
          'Tipo',
          'Comprador Email',
          'Participante Nome',
          'Participante Email',
          'CPF',
          'Telefone',
          'Empresa',
          'Cargo',
          'Nicho',
          'Funcionários',
          'Faturamento',
          'Status',
        ],
        ...allTickets.map((row) => {
          const p = row.expand?.participante_id || {}
          const c = row.expand?.comprador_id || {}
          return [
            `"${row.pedido_id}"`,
            `"${row.tipo_ingresso}"`,
            `"${c.email || ''}"`,
            `"${p.nome_completo || ''}"`,
            `"${p.email || ''}"`,
            `"${p.cpf || ''}"`,
            `"${p.telefone || ''}"`,
            `"${p.nome_empresa || ''}"`,
            `"${p.cargo || ''}"`,
            `"${p.nicho || ''}"`,
            `"${p.num_funcionarios || ''}"`,
            `"${p.faturamento_anual || ''}"`,
            `"${row.status}"`,
          ]
        }),
      ]
        .map((e) => e.join(','))
        .join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'participantes.csv'
      link.click()
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Participantes</h2>
          <p className="text-muted-foreground">Visualize e filtre todos os credenciamentos.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={loadData}>
            <RefreshCcw className="w-4 h-4" /> Atualizar
          </Button>
          <Button className="bg-primary gap-2" onClick={handleExportCSV}>
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
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Ingresso / Pedido</TableHead>
                <TableHead>Comprador</TableHead>
                <TableHead>Participante</TableHead>
                <TableHead>Empresa / Cargo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhum registro encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
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
                    <TableCell className="text-right">
                      {row.expand?.participante_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedParticipant(row.expand.participante_id)}
                        >
                          Ver Detalhes
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && totalPages > 1 && (
          <div className="py-4 border-t px-4 bg-slate-50/50 flex justify-end">
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="text-sm text-muted-foreground px-4">
                    Página {page} de {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={
                      page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>

      <Dialog
        open={!!selectedParticipant}
        onOpenChange={(val) => !val && setSelectedParticipant(null)}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-6 border-b pb-4 bg-slate-50/50">
            <DialogTitle>Detalhes do Participante</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 p-6">
            {selectedParticipant && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Nome Completo
                    </h4>
                    <p className="font-medium">{selectedParticipant.nome_completo}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">E-mail</h4>
                    <p className="font-medium">{selectedParticipant.email}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">CPF</h4>
                    <p className="font-medium">{selectedParticipant.cpf}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">Telefone</h4>
                    <p className="font-medium">{selectedParticipant.telefone}</p>
                  </div>
                </div>

                <hr />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Nome da Empresa
                    </h4>
                    <p className="font-medium">{selectedParticipant.nome_empresa}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">Cargo</h4>
                    <p className="font-medium">{selectedParticipant.cargo}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">Nicho</h4>
                    <p className="font-medium">{selectedParticipant.nicho}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Nº de Funcionários
                    </h4>
                    <p className="font-medium">{selectedParticipant.num_funcionarios}</p>
                  </div>
                  <div className="md:col-span-2">
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Faturamento Anual
                    </h4>
                    <p className="font-medium">{selectedParticipant.faturamento_anual}</p>
                  </div>
                </div>

                <hr />

                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                    Áreas de Ajuda
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {(selectedParticipant.areas_ajuda || []).map((area: string, i: number) => (
                      <span
                        key={i}
                        className="bg-slate-100 text-slate-800 text-xs px-2.5 py-1 rounded-md border"
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Expectativa (Aprendizado)
                  </h4>
                  <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-md border">
                    {selectedParticipant.expectativa_aprendizado}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Expectativa (Experiência)
                  </h4>
                  <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-md border">
                    {selectedParticipant.expectativa_experiencia}
                  </p>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}

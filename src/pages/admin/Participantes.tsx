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
import {
  Search,
  Download,
  RefreshCcw,
  Loader2,
  Link as LinkIcon,
  UserPlus,
  Pencil,
} from 'lucide-react'
import { StatusBadge, TypeBadge } from '@/components/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
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
import { AddParticipantDialog } from '@/components/admin/AddParticipantDialog'
import { EditParticipantDialog } from '@/components/admin/EditParticipantDialog'

export default function AdminParticipants() {
  const [data, setData] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 10

  const [exporting, setExporting] = useState(false)
  const [selectedParticipant, setSelectedParticipant] = useState<any>(null)
  const [participantTicket, setParticipantTicket] = useState<any | null>(null)
  const [editTicket, setEditTicket] = useState<any | null>(null)

  const buildParams = (pg: number, pp: number) => {
    const params = new URLSearchParams({ page: String(pg), perPage: String(pp) })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (typeFilter !== 'all') params.set('tipo', typeFilter)
    return params.toString()
  }

  const loadData = () => {
    setLoading(true)
    pb.send(`/backend/v1/admin/participants/search?${buildParams(page, limit)}`)
      .then((res: any) => {
        setData(res.items || [])
        setTotalPages(res.totalPages || 1)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  // Debounce da busca: só dispara ~350ms após a última tecla (evita 1 request por caractere).
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    loadData()
  }, [page, debouncedSearch, statusFilter, typeFilter])

  const handleExportCSV = async () => {
    setExporting(true)
    try {
      const perPageExp = 500
      let pageExp = 1
      let allTickets: any[] = []
      // Puxa todas as páginas do endpoint de busca (respeitando os filtros atuais).
      for (let guard = 0; guard < 500; guard++) {
        const res: any = await pb.send(
          `/backend/v1/admin/participants/search?${buildParams(pageExp, perPageExp)}`,
        )
        allTickets = allTickets.concat(res.items || [])
        if (pageExp >= (res.totalPages || 1)) break
        pageExp++
      }

      const escapeCSV = (str: any) => {
        if (!str) return '""'
        return `"${String(str).replace(/"/g, '""')}"`
      }

      const csvContent = [
        [
          'ID do Ingresso',
          'Tipo',
          'Perfil',
          'Comprador Email',
          'Participante Nome',
          'Participante Email',
          'CPF',
          'Telefone',
          'Empresa',
          'Cargo',
          'Profissão',
          'Segmento',
          'Funcionários',
          'Faturamento',
          'Uso diário de IA (1-5)',
          'Profundidade de IA (1-5)',
          'Ferramentas de IA',
          'Maior desafio com IA',
          'Status',
        ],
        ...allTickets.map((row) => {
          const p = row.expand?.participante_id || {}
          const c = row.expand?.comprador_id || {}
          const hasPart = !!row.expand?.participante_id
          const isEmpresa = p.tem_empresa === true
          const perfil = hasPart ? (isEmpresa ? 'Empresa' : 'Profissional') : ''
          // Exclusivos de empresa: vazio sem participante; 'N/A' se Profissional; valor se Empresa.
          const companyVal = (v: any) => (!hasPart ? '' : isEmpresa ? v || '' : 'N/A')
          // Cargo só existe no modo Empresa; Profissão só no modo Profissional.
          const cargoVal = !hasPart ? '' : isEmpresa ? p.cargo || '' : 'N/A'
          const profVal = !hasPart ? '' : !isEmpresa ? p.profissao || '' : 'N/A'
          // Segmento (nicho) é coletado nos dois modos.
          const segVal = !hasPart ? '' : p.nicho || ''
          return [
            escapeCSV(row.pedido_id),
            escapeCSV(row.tipo_ingresso),
            escapeCSV(perfil),
            escapeCSV(c.email),
            escapeCSV(p.nome_completo),
            escapeCSV(p.email),
            escapeCSV(p.cpf),
            escapeCSV(p.telefone),
            escapeCSV(companyVal(p.nome_empresa)),
            escapeCSV(cargoVal),
            escapeCSV(profVal),
            escapeCSV(segVal),
            escapeCSV(companyVal(p.num_funcionarios)),
            escapeCSV(companyVal(p.faturamento_anual)),
            escapeCSV(p.ia_uso_diario),
            escapeCSV(p.ia_profundidade),
            escapeCSV(p.ia_ferramentas),
            escapeCSV(p.ia_desafio),
            escapeCSV(row.status),
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
      toast({ title: 'Exportação concluída', description: 'O download foi iniciado.' })
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' })
    } finally {
      setExporting(false)
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
          <Button className="bg-primary gap-2" onClick={handleExportCSV} disabled={exporting}>
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {exporting ? 'Exportando...' : 'Exportar CSV'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[250px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email ou ID do ingresso..."
            className="pl-9 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-10 px-3 py-2 rounded-md border bg-white text-sm outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
        >
          <option value="all">Todos os Status</option>
          <option value="Pendente">Pendente</option>
          <option value="Pré-Credenciado">Pré-Credenciado</option>
        </select>
        <select
          className="h-10 px-3 py-2 rounded-md border bg-white text-sm outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value)
            setPage(1)
          }}
        >
          <option value="all">Todos os Tipos</option>
          <option value="GOLD">GOLD</option>
          <option value="PLATINUM">PLATINUM</option>
        </select>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>ID do ingresso</TableHead>
                <TableHead>Comprador</TableHead>
                <TableHead>Participante</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-10 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-24" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-8 w-24 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhum registro encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <div className="font-mono text-sm mb-1">{row.pedido_id}</div>
                      <TypeBadge type={row.tipo_ingresso} />
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
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.status === 'Pendente' && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1"
                              onClick={() => setParticipantTicket(row)}
                            >
                              <UserPlus className="w-3.5 h-3.5" /> Adicionar Participante
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-indigo-600"
                              onClick={async () => {
                                try {
                                  if (!row.id) throw new Error('Missing ingresso_id')
                                  const res = await pb.send(
                                    `/backend/v1/admin/ticket/${row.id}/invite-link`,
                                    { method: 'POST' },
                                  )
                                  const url = `https://adapta-summit-2026-d2d58.goskip.app/credenciamento?token=${res.token}`
                                  await navigator.clipboard.writeText(url)
                                  toast({ title: 'Link de pré-credenciamento copiado!' })
                                } catch (e: any) {
                                  if (e?.status === 401) {
                                    toast({
                                      title: 'Sessão expirada',
                                      description:
                                        'Sua sessão expirou. Por favor, faça login novamente.',
                                      variant: 'destructive',
                                    })
                                    window.location.href = '/admin/login'
                                  } else {
                                    toast({
                                      title: 'Erro',
                                      description:
                                        'Erro ao gerar link: verifique se o ingresso é válido.',
                                      variant: 'destructive',
                                    })
                                  }
                                }
                              }}
                            >
                              <LinkIcon className="w-4 h-4 mr-1" />
                              Copiar Link
                            </Button>
                          </>
                        )}
                        {row.expand?.participante_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1"
                            onClick={() => setEditTicket(row)}
                          >
                            <Pencil className="w-3.5 h-3.5" /> Editar
                          </Button>
                        )}
                        {row.expand?.participante_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedParticipant(row.expand.participante_id)}
                          >
                            Ver Detalhes
                          </Button>
                        )}
                      </div>
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

                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2.5 py-1 rounded-md border bg-slate-100 text-slate-700">
                    Perfil:{' '}
                    {selectedParticipant.tem_empresa === true
                      ? 'Empresa'
                      : 'Profissional (sem empresa)'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Nome da Empresa
                    </h4>
                    <p className="font-medium">
                      {selectedParticipant.tem_empresa === true
                        ? selectedParticipant.nome_empresa || '—'
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      {selectedParticipant.tem_empresa === true ? 'Cargo' : 'Profissão'}
                    </h4>
                    <p className="font-medium">
                      {selectedParticipant.tem_empresa === true
                        ? selectedParticipant.cargo || '—'
                        : selectedParticipant.profissao || '—'}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">Segmento</h4>
                    <p className="font-medium">{selectedParticipant.nicho || '—'}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Nº de Funcionários
                    </h4>
                    <p className="font-medium">
                      {selectedParticipant.tem_empresa === true
                        ? selectedParticipant.num_funcionarios || '—'
                        : 'N/A'}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Faturamento Anual
                    </h4>
                    <p className="font-medium">
                      {selectedParticipant.tem_empresa === true
                        ? selectedParticipant.faturamento_anual || '—'
                        : 'N/A'}
                    </p>
                  </div>
                </div>

                <hr />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Uso diário de IA
                    </h4>
                    <p className="font-medium">
                      {selectedParticipant.ia_uso_diario
                        ? `${selectedParticipant.ia_uso_diario}/5`
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                      Profundidade de IA
                    </h4>
                    <p className="font-medium">
                      {selectedParticipant.ia_profundidade
                        ? `${selectedParticipant.ia_profundidade}/5`
                        : '—'}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Ferramentas de IA
                  </h4>
                  <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-md border">
                    {selectedParticipant.ia_ferramentas || '—'}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-1">
                    Maior desafio com IA
                  </h4>
                  <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-md border">
                    {selectedParticipant.ia_desafio || '—'}
                  </p>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AddParticipantDialog
        ticket={participantTicket}
        open={!!participantTicket}
        onOpenChange={(val: boolean) => !val && setParticipantTicket(null)}
        onSuccess={loadData}
      />

      <EditParticipantDialog
        ticket={editTicket}
        open={!!editTicket}
        onOpenChange={(val: boolean) => !val && setEditTicket(null)}
        onSuccess={loadData}
      />
    </div>
  )
}

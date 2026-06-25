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
import { Search, Plus, Pencil, Trash2, Ticket as TicketIcon, Download } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useRealtime } from '@/hooks/use-realtime'
import { BuyerTicketsSheet } from '@/components/admin/BuyerTicketsSheet'
import { useToast } from '@/hooks/use-toast'
import { format } from 'date-fns'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { extractFieldErrors } from '@/lib/pocketbase/errors'

const formSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido').min(1, 'E-mail é obrigatório'),
})

export default function AdminCompradores() {
  const [data, setData] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 10

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [ingressosCount, setIngressosCount] = useState<Record<string, number>>({})
  const [selectedBuyer, setSelectedBuyer] = useState<any | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { nome: '', email: '' },
  })

  const loadCounts = () => {
    pb.collection('ingressos')
      .getFullList({ fields: 'comprador_id' })
      .then((res) => {
        const counts: Record<string, number> = {}
        res.forEach((item) => {
          counts[item.comprador_id] = (counts[item.comprador_id] || 0) + 1
        })
        setIngressosCount(counts)
      })
      .catch(() => {})
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const s = search.replace(/"/g, '')
      const filterStr = s ? `nome ~ "${s}" || email ~ "${s}"` : ''

      if (filterStatus !== 'all') {
        const allTickets = await pb
          .collection('ingressos')
          .getFullList({ fields: 'comprador_id,status' })
        const buyerStats: Record<string, { total: number; pendente: number; pre: number }> = {}
        allTickets.forEach((t) => {
          if (!buyerStats[t.comprador_id])
            buyerStats[t.comprador_id] = { total: 0, pendente: 0, pre: 0 }
          buyerStats[t.comprador_id].total += 1
          if (t.status === 'Pendente') buyerStats[t.comprador_id].pendente += 1
          if (t.status === 'Pré-Credenciado') buyerStats[t.comprador_id].pre += 1
        })

        const matchingIds = new Set<string>()
        for (const [buyerId, stats] of Object.entries(buyerStats)) {
          if (filterStatus === 'all_pre_credenciados') {
            if (stats.total > 0 && stats.pre === stats.total) {
              matchingIds.add(buyerId)
            }
          } else if (filterStatus === 'pending') {
            if (stats.pendente > 0) {
              matchingIds.add(buyerId)
            }
          }
        }

        const allBuyers = await pb
          .collection('compradores')
          .getFullList({ sort: '-created', filter: filterStr })
        const filteredBuyers = allBuyers.filter((b) => matchingIds.has(b.id))

        const totalItems = filteredBuyers.length
        const totalPagesCalc = Math.ceil(totalItems / limit) || 1

        let currentPage = page
        if (currentPage > totalPagesCalc && totalPagesCalc > 0) {
          setPage(totalPagesCalc)
          return
        }
        if (totalPagesCalc === 0 && currentPage !== 1) {
          setPage(1)
          return
        }

        const items = filteredBuyers.slice((currentPage - 1) * limit, currentPage * limit)
        setData(items)
        setTotalPages(totalPagesCalc)
      } else {
        const res = await pb
          .collection('compradores')
          .getList(page, limit, { sort: '-created', filter: filterStr })
        setData(res.items)
        setTotalPages(res.totalPages || 1)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [page, search, filterStatus])

  useEffect(() => {
    loadCounts()
  }, [])

  useRealtime('compradores', () => loadData())
  useRealtime('ingressos', () => {
    loadData()
    loadCounts()
  })

  const handleOpenCreate = () => {
    setEditingId(null)
    form.reset({ nome: '', email: '' })
    setDialogOpen(true)
  }

  const handleOpenEdit = (item: any) => {
    setEditingId(item.id)
    form.reset({ nome: item.nome, email: item.email })
    setDialogOpen(true)
  }

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (editingId) {
        await pb.collection('compradores').update(editingId, values)
        toast({ title: 'Comprador atualizado com sucesso!' })
      } else {
        await pb.collection('compradores').create(values)
        toast({ title: 'Comprador criado com sucesso!' })
      }
      setDialogOpen(false)
      loadData()
    } catch (err: any) {
      const fieldErrors = extractFieldErrors(err)
      if (Object.keys(fieldErrors).length > 0) {
        Object.keys(fieldErrors).forEach((field) => {
          form.setError(field as any, { message: fieldErrors[field] })
        })
      } else {
        toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' })
      }
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const tickets = await pb
        .collection('ingressos')
        .getFullList({ filter: `comprador_id="${deleteId}" && status="Pré-Credenciado"` })
      if (tickets.length > 0) {
        toast({
          title: 'Ação Bloqueada',
          description: 'Não é possível remover compradores com ingressos Pré-Credenciados.',
          variant: 'destructive',
        })
        setDeleteId(null)
        return
      }
      await pb.collection('compradores').delete(deleteId)
      toast({ title: 'Comprador removido com sucesso!' })
      if (data.length === 1 && page > 1) setPage(page - 1)
      else loadData()
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' })
    } finally {
      setDeleteId(null)
    }
  }

  const handleExportCSV = async () => {
    try {
      const s = search.replace(/"/g, '')
      const filterStr = s ? `nome ~ "${s}" || email ~ "${s}"` : ''

      const allBuyers = await pb
        .collection('compradores')
        .getFullList({ filter: filterStr, sort: '-created' })

      const allTickets = await pb.collection('ingressos').getFullList({ expand: 'participante_id' })

      const ticketsByBuyer: Record<string, any[]> = {}
      allTickets.forEach((t) => {
        if (!ticketsByBuyer[t.comprador_id]) ticketsByBuyer[t.comprador_id] = []
        ticketsByBuyer[t.comprador_id].push(t)
      })

      let finalBuyers = allBuyers
      if (filterStatus !== 'all') {
        finalBuyers = allBuyers.filter((b) => {
          const tickets = ticketsByBuyer[b.id] || []
          const total = tickets.length
          const pendente = tickets.filter((t) => t.status === 'Pendente').length
          const pre = tickets.filter((t) => t.status === 'Pré-Credenciado').length
          if (filterStatus === 'all_pre_credenciados') return total > 0 && pre === total
          if (filterStatus === 'pending') return pendente > 0
          return true
        })
      }

      const escapeCSV = (str: any) => {
        if (!str) return '""'
        return `"${String(str).replace(/"/g, '""')}"`
      }

      const csvContent = [
        [
          'Nome',
          'Email',
          'Documento',
          'Telefone',
          'Quantidade de Ingressos',
          'Categorias de Ingressos',
        ],
        ...finalBuyers.map((b) => {
          const tickets = ticketsByBuyer[b.id] || []
          const qtd = tickets.length
          const categories = Array.from(
            new Set(tickets.map((t) => t.tipo_ingresso).filter(Boolean)),
          ).join(', ')

          let doc = ''
          let phone = ''
          for (const t of tickets) {
            const p = t.expand?.participante_id
            if (p) {
              if (!doc && p.cpf) doc = p.cpf
              if (!phone && p.telefone) phone = p.telefone
            }
          }

          return [
            escapeCSV(b.nome),
            escapeCSV(b.email),
            escapeCSV(doc),
            escapeCSV(phone),
            qtd,
            escapeCSV(categories),
          ]
        }),
      ]
        .map((e) => e.join(','))
        .join('\n')

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'compradores.csv'
      link.click()
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Compradores</h2>
          <p className="text-muted-foreground">
            Visualize e gerencie todos os compradores do evento.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleExportCSV}>
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
          <Button className="bg-primary gap-2" onClick={handleOpenCreate}>
            <Plus className="w-4 h-4" /> Novo Comprador
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap max-w-2xl">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou email..."
            className="pl-9 bg-white"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select
          value={filterStatus}
          onValueChange={(val) => {
            setFilterStatus(val)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[280px] bg-white">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Compradores</SelectItem>
            <SelectItem value="all_pre_credenciados">Todos Pré-Credenciados</SelectItem>
            <SelectItem value="pending">Com Ingressos Pendentes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-xl bg-white overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Data de Criação</TableHead>
                <TableHead className="text-center">Qtd. Ingressos</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhum registro encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.nome}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(row.created), 'dd/MM/yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {ingressosCount[row.id] || 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Ver Ingressos"
                        onClick={() => setSelectedBuyer(row)}
                      >
                        <TicketIcon className="w-4 h-4 text-indigo-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(row)}>
                        <Pencil className="w-4 h-4 text-slate-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(row.id)}>
                        <Trash2 className="w-4 h-4 text-rose-500" />
                      </Button>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Comprador' : 'Novo Comprador'}</DialogTitle>
            <DialogDescription>Preencha os dados do comprador abaixo.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Nome completo" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="email@exemplo.com" {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">Salvar</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Isso excluirá permanentemente o comprador.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-rose-500 hover:bg-rose-600 text-white"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BuyerTicketsSheet
        buyer={selectedBuyer}
        open={!!selectedBuyer}
        onOpenChange={(val: boolean) => !val && setSelectedBuyer(null)}
      />
    </div>
  )
}

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
import { Search, Plus, Pencil, Trash2, Ticket as TicketIcon } from 'lucide-react'
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
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [ingressosCount, setIngressosCount] = useState<Record<string, number>>({})
  const [selectedBuyer, setSelectedBuyer] = useState<any | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome: '',
      email: '',
    },
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

  const loadData = () => {
    setLoading(true)
    pb.collection('compradores')
      .getFullList({ sort: '-created' })
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
    loadCounts()
  }, [])

  useRealtime('compradores', () => {
    loadData()
  })

  useRealtime('ingressos', () => {
    loadCounts()
  })

  const filteredData = data.filter((item) => {
    const term = search.toLowerCase()
    return item.nome.toLowerCase().includes(term) || item.email.toLowerCase().includes(term)
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
    } catch (err: any) {
      const fieldErrors = extractFieldErrors(err)
      if (Object.keys(fieldErrors).length > 0) {
        Object.keys(fieldErrors).forEach((field) => {
          form.setError(field as any, { message: fieldErrors[field] })
        })
      } else {
        toast({
          title: 'Erro ao salvar',
          description: err.message || 'Verifique se o e-mail já está em uso.',
          variant: 'destructive',
        })
      }
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await pb.collection('compradores').delete(deleteId)
      toast({ title: 'Comprador removido com sucesso!' })
    } catch (err: any) {
      toast({
        title: 'Erro ao remover',
        description: err.message || 'Verifique se não há ingressos vinculados.',
        variant: 'destructive',
      })
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Gestão de Compradores</h2>
          <p className="text-muted-foreground">
            Visualize e gerencie todos os compradores do evento.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="bg-primary gap-2" onClick={handleOpenCreate}>
            <Plus className="w-4 h-4" /> Novo Comprador
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou email..."
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
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Data de Criação</TableHead>
              <TableHead className="text-center">Qtd. Ingressos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filteredData.map((row) => (
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
              Esta ação não pode ser desfeita. Isso excluirá permanentemente o comprador e seus
              dados do servidor.
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
        onOpenChange={(val) => !val && setSelectedBuyer(null)}
      />
    </div>
  )
}

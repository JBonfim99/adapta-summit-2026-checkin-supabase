import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Plus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { useRealtime } from '@/hooks/use-realtime'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function BuyerTicketsSheet({
  buyer,
  open,
  onOpenChange,
}: {
  buyer: any
  open: boolean
  onOpenChange: (val: boolean) => void
}) {
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newTicket, setNewTicket] = useState({ tipo_ingresso: '', pedido_id: '' })
  const { toast } = useToast()

  const loadTickets = async () => {
    if (!buyer?.id) return
    setLoading(true)
    try {
      const res = await pb.collection('ingressos').getFullList({
        filter: `comprador_id = "${buyer.id}"`,
        expand: 'participante_id',
        sort: '-created',
      })
      setTickets(res)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && buyer) {
      loadTickets()
      setShowAdd(false)
    }
  }, [open, buyer])

  useRealtime('ingressos', () => {
    if (open && buyer) loadTickets()
  })

  const handleAdd = async () => {
    if (!newTicket.tipo_ingresso) {
      return toast({ title: 'Informe o tipo do ingresso', variant: 'destructive' })
    }
    try {
      await pb.collection('ingressos').create({
        comprador_id: buyer.id,
        tipo_ingresso: newTicket.tipo_ingresso,
        pedido_id: newTicket.pedido_id || `MANUAL-${Math.floor(Math.random() * 10000)}`,
        status: 'pendente',
      })
      toast({ title: 'Ingresso adicionado com sucesso!' })
      setNewTicket({ tipo_ingresso: '', pedido_id: '' })
      setShowAdd(false)
    } catch (err: any) {
      toast({ title: 'Erro ao adicionar', description: err.message, variant: 'destructive' })
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pendente':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            Pendente
          </Badge>
        )
      case 'preenchido':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Preenchido
          </Badge>
        )
      case 'enviado':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Enviado
          </Badge>
        )
      case 'erro_webhook':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            Erro
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>Ingressos de {buyer?.nome}</SheetTitle>
            <SheetDescription>Gerencie os ingressos vinculados a este comprador.</SheetDescription>
          </SheetHeader>

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
              <h3 className="text-lg font-semibold">Lista de Ingressos</h3>
              <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
                <Plus className="w-4 h-4 mr-2" /> Adicionar Ingresso
              </Button>
            </div>

            {showAdd && (
              <div className="p-4 border rounded-lg bg-slate-50 space-y-4 animate-fade-in-down">
                <h4 className="font-medium text-sm">Novo Ingresso</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>ID do Pedido (Opcional)</Label>
                    <Input
                      value={newTicket.pedido_id}
                      onChange={(e) =>
                        setNewTicket((prev) => ({ ...prev, pedido_id: e.target.value }))
                      }
                      placeholder="Ex: PED-123"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Tipo de Ingresso</Label>
                    <Select
                      value={newTicket.tipo_ingresso}
                      onValueChange={(value) =>
                        setNewTicket((prev) => ({ ...prev, tipo_ingresso: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GOLD">GOLD</SelectItem>
                        <SelectItem value="PLATINUM">PLATINUM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleAdd}>
                    Salvar
                  </Button>
                </div>
              </div>
            )}

            <div className="border rounded-lg bg-white overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Participante</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        Carregando ingressos...
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && tickets.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        Nenhum ingresso encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading &&
                    tickets.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell
                          className="font-medium max-w-[120px] truncate"
                          title={t.pedido_id}
                        >
                          {t.pedido_id}
                        </TableCell>
                        <TableCell>{t.tipo_ingresso}</TableCell>
                        <TableCell>{getStatusBadge(t.status)}</TableCell>
                        <TableCell
                          className="max-w-[150px] truncate"
                          title={t.expand?.participante_id?.nome_completo}
                        >
                          {t.expand?.participante_id?.nome_completo || (
                            <span className="text-muted-foreground text-sm italic">
                              Não preenchido
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

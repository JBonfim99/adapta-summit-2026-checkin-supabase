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
import { Plus, UserPlus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { useRealtime } from '@/hooks/use-realtime'
import { StatusBadge, TypeBadge } from '@/components/StatusBadge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AddParticipantDialog } from '@/components/admin/AddParticipantDialog'

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
  const [saving, setSaving] = useState(false)
  const [participantTicket, setParticipantTicket] = useState<any | null>(null)
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
    setSaving(true)
    try {
      await pb.send('/backend/v1/admin/tickets', {
        method: 'POST',
        body: JSON.stringify({
          comprador_id: buyer.id,
          tipo_ingresso: newTicket.tipo_ingresso,
          pedido_id: newTicket.pedido_id || undefined,
        }),
      })
      toast({ title: 'Ingresso adicionado com sucesso!' })
      setNewTicket({ tipo_ingresso: '', pedido_id: '' })
      setShowAdd(false)
      loadTickets()
    } catch (err: any) {
      toast({ title: 'Erro ao adicionar', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
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
                    <Label>ID do ingresso (Opcional)</Label>
                    <Input
                      value={newTicket.pedido_id}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(e) =>
                        setNewTicket((prev) => ({
                          ...prev,
                          pedido_id: e.target.value.replace(/\D/g, '').slice(0, 6),
                        }))
                      }
                      placeholder="Ex: 482193"
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAdd(false)}
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleAdd} disabled={saving}>
                    {saving ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
              </div>
            )}

            <div className="border rounded-lg bg-white overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>ID do ingresso</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Participante</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Carregando ingressos...
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && tickets.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
                        <TableCell>
                          <TypeBadge type={t.tipo_ingresso} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
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
                        <TableCell className="text-right">
                          {t.status === 'Pendente' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1"
                              onClick={() => setParticipantTicket(t)}
                            >
                              <UserPlus className="w-3.5 h-3.5" /> Adicionar Participante
                            </Button>
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

      <AddParticipantDialog
        ticket={participantTicket}
        open={!!participantTicket}
        onOpenChange={(val: boolean) => !val && setParticipantTicket(null)}
        onSuccess={loadTickets}
      />
    </>
  )
}

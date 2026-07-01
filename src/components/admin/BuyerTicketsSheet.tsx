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
import { Plus, UserPlus, Trash2, Pencil, ArrowLeftRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'
import { useRealtime } from '@/hooks/use-realtime'
import { StatusBadge, TypeBadge } from '@/components/StatusBadge'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AddParticipantDialog } from '@/components/admin/AddParticipantDialog'
import { EditParticipantDialog } from '@/components/admin/EditParticipantDialog'

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
  const [deleteTicket, setDeleteTicket] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editTicket, setEditTicket] = useState<any | null>(null)
  const [changeTypeTicket, setChangeTypeTicket] = useState<any | null>(null)
  const [changingType, setChangingType] = useState(false)
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

  const handleDelete = async () => {
    if (!deleteTicket) return
    setDeleting(true)
    try {
      const res: any = await pb.send(`/backend/v1/admin/tickets/${deleteTicket.id}/delete`, {
        method: 'POST',
      })
      if (res?.success === false) {
        // INAC obrigatória falhou: nada foi removido. Mantém o popup aberto.
        toast({
          title: 'Não foi removido',
          description: res.error || 'Falha ao remover.',
          variant: 'destructive',
        })
        return
      }
      toast({
        title: 'Ingresso removido',
        description: res?.inac_deleted
          ? 'Ingresso, participante e credencial na INAC removidos.'
          : 'O ingresso e o participante vinculado foram removidos.',
      })
      setDeleteTicket(null)
      loadTickets()
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err.message, variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const handleChangeType = async () => {
    if (!changeTypeTicket) return
    const target = changeTypeTicket.tipo_ingresso === 'GOLD' ? 'PLATINUM' : 'GOLD'
    setChangingType(true)
    try {
      const res: any = await pb.send(
        `/backend/v1/admin/tickets/${changeTypeTicket.id}/change-type`,
        { method: 'POST', body: JSON.stringify({ tipo: target }) },
      )
      if (res?.success === false) {
        toast({
          title: 'Não foi alterado',
          description: res.error || 'Falha ao alterar o tipo.',
          variant: 'destructive',
        })
        return
      }
      toast({ title: 'Tipo alterado', description: `Ingresso agora é ${target}.` })
      setChangeTypeTicket(null)
      loadTickets()
    } catch (err: any) {
      toast({ title: 'Erro ao alterar', description: err.message, variant: 'destructive' })
    } finally {
      setChangingType(false)
    }
  }

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
                          <div className="flex items-center justify-end gap-1">
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
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500 hover:text-slate-700"
                              title="Alterar tipo (GOLD/PLATINUM)"
                              onClick={() => setChangeTypeTicket(t)}
                            >
                              <ArrowLeftRight className="w-4 h-4" />
                            </Button>
                            {t.inac_id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-500 hover:text-slate-700"
                                title="Editar credenciamento"
                                onClick={() => setEditTicket(t)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-500 hover:text-rose-600"
                              title="Remover ingresso"
                              onClick={() => setDeleteTicket(t)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
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

      <EditParticipantDialog
        ticket={editTicket}
        open={!!editTicket}
        onOpenChange={(val: boolean) => !val && setEditTicket(null)}
        onSuccess={loadTickets}
      />

      <AlertDialog
        open={!!deleteTicket}
        onOpenChange={(o) => !o && !deleting && setDeleteTicket(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover ingresso?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 pt-1 text-sm">
                <p>
                  Você vai remover o ingresso <strong>{deleteTicket?.pedido_id}</strong> (
                  {deleteTicket?.tipo_ingresso}).
                </p>
                {deleteTicket?.expand?.participante_id?.nome_completo ? (
                  <p>
                    O participante{' '}
                    <strong>{deleteTicket.expand.participante_id.nome_completo}</strong> vinculado a
                    este ingresso <strong>também será removido</strong>
                    {deleteTicket?.status === 'Pré-Credenciado'
                      ? ', mesmo estando Pré-Credenciado'
                      : ''}
                    .
                  </p>
                ) : (
                  <p>Este ingresso não tem participante vinculado.</p>
                )}
                {(deleteTicket?.inac_id || deleteTicket?.status === 'Pré-Credenciado') && (
                  <p>
                    A credencial deste participante na <strong>INAC</strong> também será removida.
                  </p>
                )}
                <p className="font-medium text-rose-600">Esta ação não pode ser desfeita.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault()
                handleDelete()
              }}
              disabled={deleting}
              className="bg-rose-500 hover:bg-rose-600 text-white"
            >
              {deleting ? 'Removendo...' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!changeTypeTicket}
        onOpenChange={(o) => !o && !changingType && setChangeTypeTicket(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar tipo do ingresso?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 pt-1 text-sm">
                <p>
                  Ingresso <strong>{changeTypeTicket?.pedido_id}</strong>:{' '}
                  <strong>{changeTypeTicket?.tipo_ingresso}</strong> →{' '}
                  <strong>
                    {changeTypeTicket?.tipo_ingresso === 'GOLD' ? 'PLATINUM' : 'GOLD'}
                  </strong>
                  .
                </p>
                {changeTypeTicket?.inac_id && (
                  <p>
                    A categoria na <strong>INAC</strong> também será atualizada.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changingType}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault()
                handleChangeType()
              }}
              disabled={changingType}
              className="bg-primary text-white"
            >
              {changingType ? 'Alterando...' : 'Alterar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

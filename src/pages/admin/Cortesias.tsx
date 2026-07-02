import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Loader2, Gift, Copy, Users, Link as LinkIcon } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'

const PUBLIC_BASE = 'https://summit2026.goskip.app'

interface Cortesia {
  id: string
  anfitriao: string
  token: string
  tipo_ingresso: string
  limite: number
  usados: number
  ativo: boolean
  created: string
}

export default function AdminCortesias() {
  const { toast } = useToast()
  const [list, setList] = useState<Cortesia[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const [anfitriao, setAnfitriao] = useState('')
  const [tipo, setTipo] = useState('GOLD')
  const [limite, setLimite] = useState('')

  const [regOpen, setRegOpen] = useState(false)
  const [regTitle, setRegTitle] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regs, setRegs] = useState<any[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const res: any = await pb.send('/backend/v1/admin/cortesias')
      setList(res.cortesias || [])
    } catch (err: any) {
      toast({ title: 'Erro ao carregar', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const linkOf = (token: string) => `${PUBLIC_BASE}/cortesia?c=${token}`

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkOf(token))
      toast({ title: 'Link copiado!', description: 'Cole onde quiser divulgar o convite.' })
    } catch (_) {
      toast({ title: 'Copie manualmente', description: linkOf(token) })
    }
  }

  const handleCreate = async () => {
    if (anfitriao.trim().length < 2) {
      toast({ title: 'Informe o anfitrião', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      await pb.send('/backend/v1/admin/cortesias/create', {
        method: 'POST',
        body: JSON.stringify({
          anfitriao: anfitriao.trim(),
          tipo_ingresso: tipo,
          limite: limite === '' ? 0 : parseInt(limite, 10) || 0,
        }),
      })
      toast({ title: 'Convite criado!', description: `Cortesia de ${anfitriao.trim()} pronta.` })
      setAnfitriao('')
      setTipo('GOLD')
      setLimite('')
      load()
    } catch (err: any) {
      toast({ title: 'Erro ao criar', description: err.message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (c: Cortesia) => {
    try {
      await pb.send(`/backend/v1/admin/cortesias/${c.id}/toggle`, { method: 'POST' })
      load()
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    }
  }

  const openRegistros = async (c: Cortesia) => {
    setRegTitle(c.anfitriao)
    setRegOpen(true)
    setRegLoading(true)
    setRegs([])
    try {
      const res: any = await pb.send(`/backend/v1/admin/cortesias/${c.id}/registros`)
      setRegs(res.registros || [])
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    } finally {
      setRegLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
          <Gift className="w-6 h-6" /> Cortesias
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Crie links de convite para anfitriões. Quem recebe preenche só nome, e-mail e CPF e é
          credenciado na hora.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Novo convite</CardTitle>
          <CardDescription>Cada anfitrião tem seu próprio link e cota.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px_auto] items-end">
            <div>
              <label className="text-sm font-medium">Anfitrião</label>
              <Input
                value={anfitriao}
                onChange={(ev) => setAnfitriao(ev.target.value)}
                placeholder="Ex: Max Peters"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <select
                value={tipo}
                onChange={(ev) => setTipo(ev.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="GOLD">GOLD</option>
                <option value="PLATINUM">PLATINUM</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Limite</label>
              <Input
                value={limite}
                onChange={(ev) => setLimite(ev.target.value.replace(/\D/g, ''))}
                placeholder="Ilimitado"
                inputMode="numeric"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="bg-accent hover:bg-accent/90 text-white"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar convite'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Deixe o limite em branco para cortesias ilimitadas.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Convites ativos</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum convite criado ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anfitrião</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Uso</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.anfitriao}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.tipo_ingresso}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">
                        {c.usados}
                        {c.limite > 0 ? ` / ${c.limite}` : ' / ∞'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {c.ativo ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-600 border-slate-200">
                          Inativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-slate-700"
                          title="Copiar link do convite"
                          onClick={() => copy(c.token)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-slate-700"
                          title="Ver convidados"
                          onClick={() => openRegistros(c)}
                        >
                          <Users className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => handleToggle(c)}
                        >
                          {c.ativo ? 'Desativar' : 'Ativar'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={regOpen} onOpenChange={setRegOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4" /> Convidados de {regTitle}
            </DialogTitle>
            <DialogDescription>Pessoas credenciadas por este convite.</DialogDescription>
          </DialogHeader>
          {regLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : regs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Ninguém usou este convite ainda.
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>CPF</TableHead>
                    <TableHead>QR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {regs.map((r) => (
                    <TableRow key={r.ingresso_id}>
                      <TableCell className="font-medium">{r.nome || '—'}</TableCell>
                      <TableCell className="text-sm">{r.email || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{r.cpf || '—'}</TableCell>
                      <TableCell>
                        {r.credenciado ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                            OK
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                            Pendente
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

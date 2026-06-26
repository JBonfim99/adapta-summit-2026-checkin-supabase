import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Search, Download, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

interface DisparoLite {
  id: string
  nome: string
  template_nome: string
  cluster: string
  total: number
  enviados: number
  erros: number
  created: string
}

interface Envio {
  id: string
  nome: string
  email: string
  status: string
  enviado_em: string
}

const CLUSTERS: Record<string, string> = {
  todos: 'Todos os compradores',
  pendentes: 'Compradores com ingresso pendente',
  participantes_todos: 'Todos os participantes pré-credenciados',
  participantes_recentes: 'Participantes pré-credenciados (recentes)',
}

const PER_PAGE = 50

function fmtData(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR')
}

export default function DispatchDetailDialog({
  disparo,
  open,
  onOpenChange,
}: {
  disparo: DisparoLite | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const [envios, setEnvios] = useState<Envio[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const buildFilter = useCallback(
    (q: string) => {
      if (!disparo) return ''
      if (q.trim()) {
        return pb.filter('disparo_id = {:id} && (email ~ {:q} || nome ~ {:q})', {
          id: disparo.id,
          q: q.trim(),
        })
      }
      return pb.filter('disparo_id = {:id}', { id: disparo.id })
    },
    [disparo],
  )

  const load = useCallback(
    (pageToLoad: number, q: string) => {
      if (!disparo) return
      setLoading(true)
      pb.collection('envios')
        .getList(pageToLoad, PER_PAGE, { filter: buildFilter(q), sort: '-created' })
        .then((res) => {
          setEnvios(res.items as unknown as Envio[])
          setTotalPages(res.totalPages)
          setTotalItems(res.totalItems)
          setPage(res.page)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    },
    [disparo, buildFilter],
  )

  // Carrega ao abrir / trocar de disparo.
  useEffect(() => {
    if (open && disparo) {
      setSearch('')
      load(1, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, disparo])

  // Busca com debounce.
  useEffect(() => {
    if (!open || !disparo) return
    const t = setTimeout(() => load(1, search), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const handleExport = async () => {
    if (!disparo) return
    setExporting(true)
    try {
      const all = (await pb.collection('envios').getFullList({
        filter: buildFilter(search),
        sort: '-created',
      })) as unknown as Envio[]

      const esc = (v: string) => '"' + (v || '').replace(/"/g, '""') + '"'
      const linhas = [['Nome', 'E-mail', 'Status', 'Enviado em'].join(',')]
      for (const e of all) {
        linhas.push(
          [esc(e.nome), esc(e.email), esc(e.status), esc(fmtData(e.enviado_em))].join(','),
        )
      }
      const blob = new Blob(['\ufeff' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `disparo_${disparo.template_nome || disparo.id}.csv`.replace(/[^\w.-]+/g, '_')
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast({ title: 'Erro ao exportar', description: e.message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Detalhe do disparo</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm space-y-1 pt-1">
              <div>
                <span className="font-medium text-foreground">
                  {disparo?.nome || disparo?.template_nome}
                </span>
              </div>
              <div className="text-muted-foreground">
                {disparo ? CLUSTERS[disparo.cluster] || disparo.cluster : ''} · disparado em{' '}
                {fmtData(disparo?.created || '')}
              </div>
              <div className="flex gap-3 text-xs pt-1">
                <span className="text-emerald-700">{disparo?.enviados ?? 0} enviados</span>
                {(disparo?.erros ?? 0) > 0 && (
                  <span className="text-rose-600">{disparo?.erros} com erro</span>
                )}
                <span className="text-muted-foreground">de {disparo?.total ?? 0} no total</span>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={handleExport}
            disabled={exporting || totalItems === 0}
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Exportar CSV
          </Button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="max-h-[45vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">E-mail</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Enviado em</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : envios.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                      <Inbox className="w-6 h-6 mx-auto mb-2 opacity-50" />
                      Nenhum contato encontrado.
                    </td>
                  </tr>
                ) : (
                  envios.map((e) => (
                    <tr key={e.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">{e.nome || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.email}</td>
                      <td className="px-3 py-2">
                        {e.status === 'enviado' ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                            Enviado
                          </Badge>
                        ) : (
                          <Badge className="bg-rose-100 text-rose-700 border-rose-200">Erro</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {fmtData(e.enviado_em)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {totalItems} contato{totalItems === 1 ? '' : 's'}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => load(page - 1, search)}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => load(page + 1, search)}
                disabled={page >= totalPages || loading}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

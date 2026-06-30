import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Search } from 'lucide-react'
import pb from '@/lib/pocketbase/client'

const PER_PAGE = 15

// Feed das respostas individuais do formulário (mais recentes primeiro), com
// busca. Lê direto a coleção participantes (admin já tem permissão de listar).
export default function RespostasFeed() {
  const [items, setItems] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback((p: number, term: string) => {
    setLoading(true)
    const s = term.replace(/"/g, '')
    const filter = s
      ? `nome_completo ~ "${s}" || ia_ferramentas ~ "${s}" || ia_desafio ~ "${s}" || nicho ~ "${s}" || profissao ~ "${s}" || nome_empresa ~ "${s}"`
      : ''
    pb.collection('participantes')
      .getList(p, PER_PAGE, { sort: '-created', expand: 'ingresso_id', filter })
      .then((res) => {
        setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]))
        setTotalPages(res.totalPages || 1)
        setTotal(res.totalItems || 0)
        setPage(p)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(1, search), 300)
    return () => clearTimeout(t)
  }, [search, load])

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Respostas dos participantes</CardTitle>
            <CardDescription>
              As respostas individuais do formulário, mais recentes primeiro
              {total > 0 ? ` · ${total} no total` : ''}.
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar resposta, ferramenta, nome..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[520px] overflow-y-auto space-y-3 pr-1">
          {items.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma resposta encontrada.
            </p>
          )}
          {items.map((p) => {
            const tipo = p.expand?.ingresso_id?.tipo_ingresso
            const empresa = p.tem_empresa === true
            return (
              <div key={p.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.nome_completo}</span>
                  <Badge variant="outline" className="text-xs">
                    {empresa ? 'Empresa' : 'Profissional'}
                  </Badge>
                  {tipo && (
                    <Badge variant="outline" className="text-xs">
                      {tipo}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(p.created).toLocaleString('pt-BR')}
                  </span>
                </div>

                <div className="text-sm text-slate-600">
                  {empresa
                    ? [p.nome_empresa, p.cargo, p.nicho].filter(Boolean).join(' · ')
                    : [p.profissao, p.nicho].filter(Boolean).join(' · ')}
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-slate-100">
                    Uso {p.ia_uso_diario || '—'}/5
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100">
                    Profundidade {p.ia_profundidade || '—'}/5
                  </span>
                </div>

                {p.ia_ferramentas && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Ferramentas: </span>
                    {p.ia_ferramentas}
                  </div>
                )}
                {p.ia_desafio && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Desafio: </span>
                    {p.ia_desafio}
                  </div>
                )}
              </div>
            )
          })}

          {page < totalPages && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(page + 1, search)}
                disabled={loading}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Carregar mais
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

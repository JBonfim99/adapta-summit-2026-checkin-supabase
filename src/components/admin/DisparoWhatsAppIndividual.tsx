import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Send, User, Search, X } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

interface Recipient {
  id: string
  nome: string
  email: string
}

export default function DisparoWhatsAppIndividual({ onSent }: { onSent?: () => void }) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Recipient[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Recipient | null>(null)
  const [nome, setNome] = useState('')
  const [sending, setSending] = useState(false)

  // Busca com debounce (não busca enquanto já há um selecionado).
  useEffect(() => {
    if (selected) return
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let active = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res: any = await pb.send('/backend/v1/admin/dispatch/search-recipient', {
          method: 'POST',
          body: JSON.stringify({ audience: 'compradores', q }),
        })
        if (active) setResults(res?.results || [])
      } catch (_) {
        if (active) setResults([])
      } finally {
        if (active) setSearching(false)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [query, selected])

  const handleSend = async () => {
    if (!selected) return
    setSending(true)
    try {
      const res: any = await pb.send('/backend/v1/admin/whatsapp/send-individual', {
        method: 'POST',
        body: JSON.stringify({ recipient_id: selected.id, nome }),
      })
      if (res && res.success === false) {
        // Mantém a seleção pra permitir tentar de novo.
        toast({
          title: 'Falha no envio',
          description: res.error || `HTTP ${res.status || '-'}`,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'WhatsApp enviado!',
          description: `${selected.nome || selected.email}`,
        })
        setSelected(null)
        setQuery('')
        setResults([])
        setNome('')
        onSent?.()
      }
    } catch (e: any) {
      toast({ title: 'Erro ao enviar', description: e.message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <User className="w-5 h-5" /> Disparo individual
        </CardTitle>
        <CardDescription>
          Envio imediato do WhatsApp de acesso para um comprador específico.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium">Destinatário</label>
          {selected ? (
            <div className="flex items-center justify-between rounded-lg border bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{selected.nome || '(sem nome)'}</p>
                <p className="text-xs text-muted-foreground truncate">{selected.email}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por nome ou e-mail..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {(searching || results.length > 0 || query.trim().length >= 2) && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-white shadow-lg max-h-64 overflow-auto">
                  {searching && (
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
                    </div>
                  )}
                  {!searching &&
                    results.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelected(r)
                          setResults([])
                        }}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="font-medium text-sm">{r.nome || '(sem nome)'}</span>
                        <span className="text-xs text-muted-foreground">{r.email}</span>
                      </button>
                    ))}
                  {!searching && results.length === 0 && query.trim().length >= 2 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Nome do disparo (opcional)</label>
          <Input
            placeholder="Ex: Reenvio manual WhatsApp"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>

        <Button
          className="bg-[#25D366] hover:bg-[#1ebe5a] text-white gap-2"
          onClick={handleSend}
          disabled={!selected || sending}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Enviar
        </Button>
      </CardContent>
    </Card>
  )
}

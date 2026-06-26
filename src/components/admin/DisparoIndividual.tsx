import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Loader2, Send, User, Search, X } from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { useToast } from '@/hooks/use-toast'

interface Tpl {
  id: string
  name: string
}
interface Recipient {
  id: string
  nome: string
  email: string
}

export default function DisparoIndividual({ templates }: { templates: Tpl[] }) {
  const { toast } = useToast()
  const [audience, setAudience] = useState<'compradores' | 'participantes'>('compradores')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Recipient[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Recipient | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [nome, setNome] = useState('')
  const [sending, setSending] = useState(false)

  const filteredTemplates = templates.filter((t) => (t.name || '').toLowerCase().includes('summit'))
  const templateName = templates.find((t) => t.id === templateId)?.name || templateId

  // Troca de público limpa a seleção e a busca.
  useEffect(() => {
    setSelected(null)
    setResults([])
    setQuery('')
  }, [audience])

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
          body: JSON.stringify({ audience, q }),
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
  }, [query, audience, selected])

  const handleSend = async () => {
    if (!selected || !templateId) return
    setSending(true)
    try {
      await pb.send('/backend/v1/admin/dispatch/enqueue', {
        method: 'POST',
        body: JSON.stringify({
          cluster: 'individual',
          audience,
          recipient_id: selected.id,
          nome,
          template_id: templateId,
          template_nome: templateName,
        }),
      })
      toast({
        title: 'Disparo individual enviado!',
        description: `${selected.nome || selected.email} • ${selected.email}`,
      })
      setSelected(null)
      setQuery('')
      setResults([])
      setNome('')
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
          Envie um template para um comprador ou participante específico.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium">Público</label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={audience === 'compradores' ? 'default' : 'outline'}
              className={audience === 'compradores' ? 'bg-primary' : ''}
              onClick={() => setAudience('compradores')}
            >
              Comprador
            </Button>
            <Button
              type="button"
              variant={audience === 'participantes' ? 'default' : 'outline'}
              className={audience === 'participantes' ? 'bg-primary' : ''}
              onClick={() => setAudience('participantes')}
            >
              Participante
            </Button>
          </div>
        </div>

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
            placeholder="Ex: Reenvio manual"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Template (SendGrid)</label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um template" />
            </SelectTrigger>
            <SelectContent>
              {filteredTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          className="bg-primary gap-2"
          onClick={handleSend}
          disabled={!selected || !templateId || sending}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Enviar
        </Button>
      </CardContent>
    </Card>
  )
}

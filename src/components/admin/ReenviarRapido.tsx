import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { AlertCircle, CheckCircle2, Loader2, Send } from 'lucide-react'
import backend from '@/lib/backend/client'

export interface AlvoReenvio {
  audience: 'compradores' | 'participantes'
  id: string
  nome: string
  email: string
  contexto?: string
}

interface Tpl {
  id: string
  name: string
}

let cacheTemplates: Tpl[] | null = null

const TEMPLATE_PADRAO: Record<AlvoReenvio['audience'], string> = {
  compradores: 'Skip-Summit26-Send-Comprador-Email02',
  participantes: 'Skip-Summit26-Send-Participante',
}

export default function ReenviarRapido({
  alvo,
  onClose,
}: {
  alvo: AlvoReenvio | null
  onClose: () => void
}) {
  const [templates, setTemplates] = useState<Tpl[]>(cacheTemplates || [])
  const [carregando, setCarregando] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  const publico = alvo?.audience || 'compradores'

  const filtrados = templates.filter((template) => {
    const nome = (template.name || '').toLowerCase()
    if (!nome.includes('skip-summit26')) return false
    return publico === 'participantes' ? nome.includes('participante') : nome.includes('comprador')
  })

  useEffect(() => {
    if (!alvo) return
    setErro('')
    setOk('')
    setEnviando(false)

    const escolher = (lista: Tpl[]) => {
      const disponiveis = lista.filter((template) => {
        const nome = (template.name || '').toLowerCase()
        if (!nome.includes('skip-summit26')) return false
        return alvo.audience === 'participantes'
          ? nome.includes('participante')
          : nome.includes('comprador')
      })
      const padrao = disponiveis.find(
        (template) => template.name === TEMPLATE_PADRAO[alvo.audience],
      )
      setTemplateId(padrao?.id || disponiveis[0]?.id || '')
      if (disponiveis.length === 0) {
        setErro(
          'Nenhum template de e-mail para este público foi encontrado no SendGrid. Nada pode ser enviado por aqui.',
        )
      }
    }

    if (cacheTemplates) {
      setTemplates(cacheTemplates)
      escolher(cacheTemplates)
      return
    }

    setCarregando(true)
    backend
      .send('/backend/v1/admin/sendgrid/templates')
      .then((response: any) => {
        const lista: Tpl[] = response.templates || []
        cacheTemplates = lista
        setTemplates(lista)
        escolher(lista)
      })
      .catch((error: any) => {
        setErro(
          `Não foi possível carregar os templates de e-mail: ${error?.message || 'erro desconhecido'}. Nada foi enviado.`,
        )
      })
      .finally(() => setCarregando(false))
  }, [alvo])

  const enviar = async () => {
    if (!alvo) return
    setErro('')
    setOk('')
    if (!templateId) {
      setErro('Escolha o template antes de enviar.')
      return
    }
    if (!alvo.email) {
      setErro('Este destinatário não tem e-mail cadastrado, então não há para onde enviar.')
      return
    }
    if (!alvo.id) {
      setErro(
        'Não consegui identificar o cadastro deste destinatário (id ausente na listagem). Recarregue a página e tente de novo; se repetir, avise o suporte.',
      )
      return
    }

    setEnviando(true)
    try {
      const templateNome =
        templates.find((template) => template.id === templateId)?.name || templateId
      const response: any = await backend.send('/backend/v1/admin/dispatch/enqueue', {
        method: 'POST',
        body: JSON.stringify({
          cluster: 'individual',
          audience: alvo.audience,
          recipient_id: alvo.id,
          nome: `Reenvio individual — ${alvo.nome || alvo.email}`,
          template_id: templateId,
          template_nome: templateNome,
        }),
      })
      if (!response || response.enqueued === 0) {
        setErro(
          'Nada foi enviado. Isso acontece quando o destinatário está sem e-mail cadastrado ou já tem um envio em andamento neste momento. Confira em Envios e tente de novo em alguns segundos.',
        )
        return
      }
      setOk(`E-mail colocado na fila para ${alvo.email}. Acompanhe o resultado em Envios.`)
    } catch (error: any) {
      if (error?.status === 401) {
        setErro('Sua sessão expirou. Faça login de novo — nada foi enviado.')
        setTimeout(() => {
          window.location.href = '/admin/login'
        }, 1500)
        return
      }
      setErro(`Falha ao enviar: ${error?.message || 'erro desconhecido'}. Nada foi enviado.`)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={!!alvo} onOpenChange={(open) => !open && !enviando && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {publico === 'participantes' ? 'Reenviar ingresso' : 'Reenviar e-mail de acesso'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-slate-50 p-3 text-sm space-y-1">
            <div className="font-semibold text-slate-800">{alvo?.nome || '—'}</div>
            <div className="text-slate-600 break-all">{alvo?.email || 'sem e-mail cadastrado'}</div>
            {alvo?.contexto && <div className="text-slate-500">{alvo.contexto}</div>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Template</Label>
            {carregando ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando templates...
              </div>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId} disabled={enviando}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o template" />
                </SelectTrigger>
                <SelectContent>
                  {filtrados.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Já vem com o template padrão deste público — só troque se precisar.
            </p>
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          {ok && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{ok}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={enviando}>
              {ok ? 'Fechar' : 'Cancelar'}
            </Button>
            {!ok && (
              <Button
                onClick={enviar}
                disabled={enviando || carregando || !templateId}
                className="gap-2"
              >
                {enviando ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Enviar agora
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

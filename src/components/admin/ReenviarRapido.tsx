import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertCircle, CheckCircle2, Loader2, Send } from 'lucide-react'
import backend from '@/lib/backend/client'

export interface AlvoReenvio {
  audience: 'compradores' | 'participantes'
  id: string
  nome: string
  email: string
  contexto?: string
}

export default function ReenviarRapido({
  alvo,
  onClose,
}: {
  alvo: AlvoReenvio | null
  onClose: () => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    setErro('')
    setOk('')
    setEnviando(false)
  }, [alvo])

  const enviar = async () => {
    if (!alvo) return
    setErro('')
    setOk('')
    if (!alvo.email) {
      setErro('Este destinatario nao tem e-mail cadastrado.')
      return
    }

    setEnviando(true)
    try {
      await backend.send('/backend/v1/admin/resend', {
        method: 'POST',
        body: JSON.stringify({
          audience: alvo.audience,
          recipient_id: alvo.id,
        }),
      })
      setOk(`E-mail enviado para ${alvo.email}.`)
    } catch (error: any) {
      setErro(`Falha ao enviar: ${error?.message || 'erro desconhecido'}.`)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={!!alvo} onOpenChange={(open) => !open && !enviando && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {alvo?.audience === 'participantes'
              ? 'Reenviar ingresso'
              : 'Reenviar e-mail de acesso'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-slate-50 p-3 text-sm space-y-1">
            <div className="font-semibold text-slate-800">{alvo?.nome || '-'}</div>
            <div className="text-slate-600 break-all">{alvo?.email || 'sem e-mail'}</div>
            {alvo?.contexto && <div className="text-slate-500">{alvo.contexto}</div>}
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

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={enviando}>
              {ok ? 'Fechar' : 'Cancelar'}
            </Button>
            {!ok && (
              <Button onClick={enviar} disabled={enviando} className="gap-2">
                {enviando ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Enviar agora
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

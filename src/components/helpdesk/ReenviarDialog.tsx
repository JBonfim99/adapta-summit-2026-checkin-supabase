import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { Avisos, Erro } from '@/components/helpdesk/AcoesDialogs'
import { avisosDe, hdReenviarComprador, hdReenviarParticipante } from '@/lib/helpdesk'

export interface AlvoReenvio {
  tipo: 'comprador' | 'participante'
  id: string
  nome: string
  email: string
  /** ex.: número do pedido, para o atendente conferir antes de disparar */
  contexto?: string
}

// Confirmação antes de disparar: mostra para QUEM vai e O QUE vai, porque
// e-mail enviado não volta atrás.
export default function ReenviarDialog({
  alvo,
  onClose,
  onDone,
}: {
  alvo: AlvoReenvio | null
  onClose: () => void
  onDone: () => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])
  const [enviado, setEnviado] = useState(false)

  useEffect(() => {
    if (!alvo) return
    setEnviando(false)
    setErro('')
    setAvisos([])
    setEnviado(false)
  }, [alvo])

  const enviar = async () => {
    if (!alvo) return
    setErro('')
    setEnviando(true)
    try {
      const res: any =
        alvo.tipo === 'comprador'
          ? await hdReenviarComprador(alvo.id)
          : await hdReenviarParticipante(alvo.id)
      setAvisos(avisosDe(res))
      setEnviado(true)
      onDone()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const ehComprador = alvo?.tipo === 'comprador'

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && !enviando && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {enviado
              ? 'E-mail enviado'
              : ehComprador
                ? 'Reenviar e-mail de acesso'
                : 'Reenviar ingresso'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl border-2 bg-slate-50 p-4 space-y-1">
            <p className="text-sm uppercase tracking-wide text-slate-500 font-semibold">Vai para</p>
            <p className="text-lg font-bold text-slate-900">{alvo?.nome}</p>
            <p className="text-base text-slate-700 break-all">{alvo?.email}</p>
            {alvo?.contexto && <p className="text-sm text-slate-500">{alvo.contexto}</p>}
          </div>

          {!enviado && (
            <p className="text-base text-slate-600">
              {ehComprador
                ? 'Este e-mail leva o link para o comprador preencher os dados de quem vai usar os ingressos.'
                : 'Este e-mail leva o link do ingresso da própria pessoa, com a credencial dela.'}{' '}
              Confira o endereço acima antes de enviar.
            </p>
          )}

          {enviado && (
            <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800">
              <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
              <span>
                E-mail enviado. Peça para a pessoa conferir também a caixa de spam ou promoções.
              </span>
            </div>
          )}

          <Erro msg={erro} />
          <Avisos lista={avisos} />

          {enviado ? (
            <Button variant="outline" size="lg" className="w-full h-14 text-base" onClick={onClose}>
              Fechar
            </Button>
          ) : (
            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <Button
                variant="outline"
                size="lg"
                className="h-14 text-base sm:flex-1"
                onClick={onClose}
                disabled={enviando}
              >
                Cancelar
              </Button>
              <Button
                size="lg"
                className="h-14 text-base sm:flex-[2] gap-2"
                onClick={enviar}
                disabled={enviando}
              >
                {enviando ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" /> Reenviar agora
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

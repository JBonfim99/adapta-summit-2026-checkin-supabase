import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, Loader2, UserPlus } from 'lucide-react'
import PessoaForm from '@/components/helpdesk/PessoaForm'
import QrGrande from '@/components/helpdesk/QrGrande'
import { Avisos, Erro } from '@/components/helpdesk/AcoesDialogs'
import { avisosDe, hdNovoCredenciamento, type HDPessoaForm } from '@/lib/helpdesk'

const VAZIO: HDPessoaForm = {
  nome_completo: '',
  email: '',
  cpf: '',
  telefone: '',
  empresa: '',
}

const MOTIVOS_RAPIDOS = [
  'Comprou na hora, no balcão',
  'Ingresso não apareceu na busca',
  'Convidado autorizado pela organização',
]

// Credenciamento de quem NÃO está na base: cria comprador + ingresso +
// participante e já emite a credencial. Exige tipo e motivo escritos.
export default function NovoCredenciamentoDialog({
  aberto,
  onClose,
  onDone,
}: {
  aberto: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [tipo, setTipo] = useState<'GOLD' | 'PLATINUM' | ''>('')
  const [form, setForm] = useState<HDPessoaForm>(VAZIO)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [qr, setQr] = useState('')
  const [pedido, setPedido] = useState('')
  const [concluido, setConcluido] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setTipo('')
    setForm(VAZIO)
    setMotivo('')
    setErro('')
    setAvisos([])
    setSalvando(false)
    setQr('')
    setPedido('')
    setConcluido(false)
  }, [aberto])

  const criar = async () => {
    setErro('')
    if (tipo !== 'GOLD' && tipo !== 'PLATINUM') {
      setErro('Escolha primeiro o tipo do ingresso: GOLD ou PLATINUM.')
      return
    }
    if (!form.nome_completo.trim() || !form.email.trim()) {
      setErro('Preencha pelo menos o nome e o e-mail da pessoa.')
      return
    }
    if (!form.cpf.trim() || !form.telefone.trim()) {
      setErro('Preencha o CPF e o telefone da pessoa.')
      return
    }
    if (motivo.trim().length < 5) {
      setErro('Escreva o motivo deste novo credenciamento (pelo menos 5 letras).')
      return
    }
    setSalvando(true)
    try {
      const res: any = await hdNovoCredenciamento({ ...form, tipo, motivo: motivo.trim() })
      setAvisos(avisosDe(res))
      setQr(res.qrcode || '')
      setPedido(res.pedido_id || '')
      setConcluido(true)
      onDone()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  const botaoTipo = (t: 'GOLD' | 'PLATINUM') => (
    <Button
      type="button"
      variant={tipo === t ? 'default' : 'outline'}
      className="h-16 text-lg font-bold flex-1"
      disabled={salvando}
      onClick={() => {
        setTipo(t)
        setErro('')
      }}
    >
      {t}
    </Button>
  )

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && !salvando && onClose()}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {concluido ? 'Credenciamento criado' : 'Novo credenciamento'}
          </DialogTitle>
        </DialogHeader>

        {concluido ? (
          <div className="space-y-5 py-2">
            {qr && (
              <div className="flex items-center justify-center gap-2 text-emerald-700 text-lg font-semibold">
                <CheckCircle2 className="w-6 h-6" /> Credencial criada com sucesso
              </div>
            )}
            <div className="rounded-xl bg-slate-50 border p-4 text-base text-slate-700 text-center">
              Número do pedido: <span className="font-mono font-bold">{pedido}</span>
            </div>
            <Avisos lista={avisos} />
            {qr ? (
              <QrGrande value={qr} nome={form.nome_completo} arquivo={pedido} />
            ) : (
              <Erro msg="O cadastro foi criado, mas o QR Code não saiu. Feche esta janela, busque a pessoa pelo nome e use o botão 'Gerar credencial'." />
            )}
            <Button variant="outline" size="lg" className="w-full h-14 text-base" onClick={onClose}>
              Concluir
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
              Use isto só quando a pessoa <b>não aparece na busca</b>. Se ela já tem ingresso no
              sistema, feche e busque pelo nome, e-mail ou CPF.
            </div>

            <div className="rounded-xl border-2 p-5 space-y-3">
              <h3 className="text-lg font-bold text-slate-900">1. Tipo do ingresso</h3>
              <div className="flex gap-3">
                {botaoTipo('GOLD')}
                {botaoTipo('PLATINUM')}
              </div>
            </div>

            <div className="rounded-xl border-2 p-5 space-y-4">
              <h3 className="text-lg font-bold text-slate-900">2. Dados da pessoa</h3>
              <PessoaForm valor={form} onChange={setForm} disabled={salvando} />
            </div>

            <div className="rounded-xl border-2 p-5 space-y-4">
              <h3 className="text-lg font-bold text-slate-900">3. Motivo</h3>
              <div className="space-y-2">
                <Label className="text-base font-semibold text-slate-800">
                  Motivos mais comuns (toque em um)
                </Label>
                <div className="grid gap-2">
                  {MOTIVOS_RAPIDOS.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      variant={motivo === m ? 'default' : 'outline'}
                      className="h-12 justify-start text-base"
                      disabled={salvando}
                      onClick={() => {
                        setMotivo(m)
                        setErro('')
                      }}
                    >
                      {m}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="hd-motivo-novo" className="text-base font-semibold text-slate-800">
                  Motivo deste credenciamento
                </Label>
                <Textarea
                  id="hd-motivo-novo"
                  className="text-lg min-h-24"
                  placeholder="Escreva o motivo com suas palavras"
                  value={motivo}
                  disabled={salvando}
                  onChange={(ev) => {
                    setMotivo(ev.target.value)
                    setErro('')
                  }}
                />
                <p className="text-sm text-slate-500">Obrigatório — pelo menos 5 letras.</p>
              </div>
            </div>

            <Erro msg={erro} />

            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <Button
                variant="outline"
                size="lg"
                className="h-14 text-base sm:flex-1"
                onClick={onClose}
                disabled={salvando}
              >
                Cancelar
              </Button>
              <Button
                size="lg"
                className="h-14 text-base sm:flex-[2] gap-2"
                onClick={criar}
                disabled={salvando}
              >
                {salvando ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Criando credencial...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-5 h-5" /> Criar e gerar QR Code
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

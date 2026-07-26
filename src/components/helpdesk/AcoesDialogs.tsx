import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, ArrowRightLeft, CheckCircle2, Loader2, QrCode, Save } from 'lucide-react'
import PessoaForm from '@/components/helpdesk/PessoaForm'
import QrGrande from '@/components/helpdesk/QrGrande'
import {
  avisosDe,
  hdCredenciar,
  hdEditar,
  hdGerarQr,
  hdTrocarTipo,
  hdVerQr,
  mascaraCpf,
  mascaraTelefone,
  type HDComprador,
  type HDIngresso,
  type HDPessoaForm,
} from '@/lib/helpdesk'

const VAZIO: HDPessoaForm = {
  nome_completo: '',
  email: '',
  cpf: '',
  telefone: '',
  empresa: '',
}

function Erro({ msg }: { msg: string }) {
  if (!msg) return null
  return (
    <div className="flex items-start gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
      <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  )
}

// Ação concluída, mas com alguma parte que não saiu perfeita. Aparece sempre —
// nunca engolimos esse tipo de problema.
function Avisos({ lista }: { lista: string[] }) {
  if (!lista || lista.length === 0) return null
  return (
    <div className="space-y-2">
      {lista.map((a, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-base text-amber-900"
        >
          <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
          <span>{a}</span>
        </div>
      ))}
    </div>
  )
}

function TipoBadge({ tipo }: { tipo: string }) {
  return (
    <Badge
      variant="outline"
      className={
        tipo === 'PLATINUM'
          ? 'border-slate-300 bg-slate-800 text-white text-sm px-3 py-1'
          : 'border-amber-300 bg-amber-100 text-amber-900 text-sm px-3 py-1'
      }
    >
      {tipo}
    </Badge>
  )
}

// ------------------------------------------------------------ CREDENCIAR

export function CredenciarDialog({
  ingresso,
  comprador,
  onClose,
  onDone,
}: {
  ingresso: HDIngresso | null
  comprador: HDComprador | null
  onClose: () => void
  onDone: () => void
}) {
  const [form, setForm] = useState<HDPessoaForm>(VAZIO)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [qr, setQr] = useState('')
  const [avisoQr, setAvisoQr] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])

  useEffect(() => {
    if (!ingresso) return
    setErro('')
    setQr('')
    setAvisoQr('')
    setAvisos([])
    setSalvando(false)
    const doc = (comprador?.documento || '').replace(/\D/g, '')
    setForm({
      nome_completo: comprador?.nome || '',
      email: comprador?.email || '',
      cpf: doc.length === 11 ? mascaraCpf(doc) : '',
      telefone: comprador?.telefone ? mascaraTelefone(comprador.telefone) : '',
      empresa: '',
    })
  }, [ingresso, comprador])

  const salvar = async () => {
    if (!ingresso) return
    setErro('')
    if (
      !form.nome_completo.trim() ||
      !form.email.trim() ||
      !form.cpf.trim() ||
      !form.telefone.trim()
    ) {
      setErro('Preencha nome, e-mail, CPF e telefone.')
      return
    }
    setSalvando(true)
    try {
      const res: any = await hdCredenciar(ingresso.id, form)
      setAvisos(avisosDe(res))
      if (res.qrcode) setQr(res.qrcode)
      else
        setAvisoQr(res.inac_msg || 'o servidor não informou o motivo — chame o suporte se repetir')
      onDone()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={!!ingresso} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {qr || avisoQr ? 'Pronto!' : 'Credenciar pessoa'}
          </DialogTitle>
        </DialogHeader>

        {qr ? (
          <div className="space-y-6 py-2">
            <div className="flex items-center justify-center gap-2 text-emerald-700 text-lg font-semibold">
              <CheckCircle2 className="w-6 h-6" /> Credencial criada com sucesso
            </div>
            <Avisos lista={avisos} />
            <QrGrande value={qr} nome={form.nome_completo} arquivo={ingresso?.pedido_id} />
            <Button variant="outline" size="lg" className="w-full h-14 text-base" onClick={onClose}>
              Concluir
            </Button>
          </div>
        ) : avisoQr ? (
          <div className="space-y-5 py-2">
            <Erro
              msg={`A pessoa foi credenciada, mas o QR Code ainda NÃO foi gerado. Motivo: ${avisoQr}. Feche esta janela e clique em "Gerar credencial" no ingresso daqui a pouco.`}
            />
            <Avisos lista={avisos} />
            <Button variant="outline" size="lg" className="w-full h-14 text-base" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 border p-4">
              <TipoBadge tipo={ingresso?.tipo_ingresso || 'GOLD'} />
              <span className="text-base text-slate-700">
                Pedido <span className="font-mono font-semibold">{ingresso?.pedido_id}</span>
              </span>
            </div>
            <p className="text-base text-slate-600">
              Confira os dados com a pessoa. Os dados já vieram preenchidos com os da compra —
              corrija se o ingresso for de outra pessoa.
            </p>
            <PessoaForm valor={form} onChange={setForm} disabled={salvando} />
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
                onClick={salvar}
                disabled={salvando}
              >
                {salvando ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Gerando credencial...
                  </>
                ) : (
                  <>
                    <QrCode className="w-5 h-5" /> Credenciar e gerar QR Code
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

// ------------------------------------------------------------------- QR

export function QrDialog({
  ingresso,
  onClose,
  onDone,
}: {
  ingresso: HDIngresso | null
  onClose: () => void
  onDone: () => void
}) {
  const [carregando, setCarregando] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [qr, setQr] = useState('')
  const [nome, setNome] = useState('')
  const [temParticipante, setTemParticipante] = useState(false)
  const [erro, setErro] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])

  useEffect(() => {
    if (!ingresso) return
    setQr('')
    setErro('')
    setNome('')
    setAvisos([])
    setCarregando(true)
    hdVerQr(ingresso.id)
      .then((res: any) => {
        setQr(res.qrcode || '')
        setNome(res.nome || '')
        setTemParticipante(!!res.tem_participante)
      })
      .catch((e: any) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [ingresso])

  const gerar = async () => {
    if (!ingresso) return
    setErro('')
    setGerando(true)
    try {
      const res: any = await hdGerarQr(ingresso.id)
      setAvisos(avisosDe(res))
      if (!res.qrcode) {
        setErro(
          'O servidor respondeu que deu certo, mas não devolveu o código da credencial. Chame o suporte antes de tentar de novo.',
        )
      }
      setQr(res.qrcode || '')
      onDone()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setGerando(false)
    }
  }

  return (
    <Dialog open={!!ingresso} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">QR Code da credencial</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 border p-4">
            <TipoBadge tipo={ingresso?.tipo_ingresso || 'GOLD'} />
            <span className="text-base text-slate-700">
              Pedido <span className="font-mono font-semibold">{ingresso?.pedido_id}</span>
            </span>
          </div>

          {carregando ? (
            <div className="flex flex-col items-center gap-3 py-10 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-base">Buscando o QR Code...</span>
            </div>
          ) : qr ? (
            <QrGrande value={qr} nome={nome} arquivo={ingresso?.pedido_id} />
          ) : temParticipante ? (
            <div className="space-y-4">
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-base text-amber-900">
                Esta pessoa preencheu os dados, mas a credencial ainda não foi gerada. Clique no
                botão abaixo para gerar agora.
              </div>
              <Button
                size="lg"
                className="w-full h-14 text-base gap-2"
                onClick={gerar}
                disabled={gerando}
              >
                {gerando ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Gerando...
                  </>
                ) : (
                  <>
                    <QrCode className="w-5 h-5" /> Gerar credencial agora
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4 text-base text-slate-700">
              Este ingresso ainda não tem ninguém credenciado. Feche esta janela e clique em
              "Credenciar".
            </div>
          )}

          <Erro msg={erro} />
          <Avisos lista={avisos} />

          <Button variant="outline" size="lg" className="w-full h-14 text-base" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --------------------------------------------------------------- ALTERAR

export function AlterarDialog({
  ingresso,
  onClose,
  onDone,
}: {
  ingresso: HDIngresso | null
  onClose: () => void
  onDone: () => void
}) {
  const [form, setForm] = useState<HDPessoaForm>(VAZIO)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [trocando, setTrocando] = useState(false)
  const [confirmarTroca, setConfirmarTroca] = useState(false)
  const [tipoAtual, setTipoAtual] = useState('GOLD')

  useEffect(() => {
    if (!ingresso) return
    setErro('')
    setOk('')
    setAvisos([])
    setConfirmarTroca(false)
    setTipoAtual(ingresso.tipo_ingresso)
    const p = ingresso.participante
    setForm({
      nome_completo: p?.nome_completo || '',
      email: p?.email || '',
      cpf: p?.cpf ? mascaraCpf(p.cpf) : '',
      telefone: p?.telefone ? mascaraTelefone(p.telefone) : '',
      empresa: p?.empresa || '',
    })
  }, [ingresso])

  const outroTipo = tipoAtual === 'GOLD' ? 'PLATINUM' : 'GOLD'

  const salvarDados = async () => {
    if (!ingresso) return
    setErro('')
    setOk('')
    setAvisos([])
    setSalvando(true)
    try {
      const res: any = await hdEditar(ingresso.id, form)
      setAvisos(avisosDe(res))
      setOk('Dados alterados com sucesso.')
      onDone()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  const trocarTipo = async () => {
    if (!ingresso) return
    setErro('')
    setOk('')
    setAvisos([])
    setTrocando(true)
    try {
      const res: any = await hdTrocarTipo(ingresso.id, outroTipo as 'GOLD' | 'PLATINUM')
      setAvisos(avisosDe(res))
      setTipoAtual(outroTipo)
      setConfirmarTroca(false)
      setOk(`Ingresso alterado para ${outroTipo}.`)
      onDone()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setTrocando(false)
    }
  }

  return (
    <Dialog open={!!ingresso} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Alterar ingresso</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 border p-4">
            <TipoBadge tipo={tipoAtual} />
            <span className="text-base text-slate-700">
              Pedido <span className="font-mono font-semibold">{ingresso?.pedido_id}</span>
            </span>
          </div>

          {/* 1. Tipo do ingresso */}
          <div className="rounded-xl border-2 p-5 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">1. Tipo do ingresso</h3>
            <p className="text-base text-slate-600">
              Hoje este ingresso é <b>{tipoAtual}</b>.
            </p>
            {confirmarTroca ? (
              <div className="space-y-3">
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-base text-amber-900">
                  Confirma mudar de <b>{tipoAtual}</b> para <b>{outroTipo}</b>? A credencial da
                  pessoa é atualizada na hora.
                </div>
                <div className="flex flex-col-reverse sm:flex-row gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-14 text-base sm:flex-1"
                    onClick={() => setConfirmarTroca(false)}
                    disabled={trocando}
                  >
                    Não, voltar
                  </Button>
                  <Button
                    size="lg"
                    className="h-14 text-base sm:flex-1 gap-2"
                    onClick={trocarTipo}
                    disabled={trocando}
                  >
                    {trocando ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" /> Alterando...
                      </>
                    ) : (
                      <>Sim, mudar para {outroTipo}</>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="lg"
                className="w-full h-14 text-base gap-2"
                onClick={() => setConfirmarTroca(true)}
              >
                <ArrowRightLeft className="w-5 h-5" /> Mudar para {outroTipo}
              </Button>
            )}
          </div>

          {/* 2. Dados da pessoa */}
          <div className="rounded-xl border-2 p-5 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">2. Dados da pessoa</h3>
            {ingresso?.participante ? (
              <>
                <PessoaForm valor={form} onChange={setForm} disabled={salvando} />
                <Button
                  size="lg"
                  className="w-full h-14 text-base gap-2"
                  onClick={salvarDados}
                  disabled={salvando}
                >
                  {salvando ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" /> Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" /> Salvar alterações
                    </>
                  )}
                </Button>
              </>
            ) : (
              <p className="text-base text-slate-600">
                Este ingresso ainda não tem ninguém credenciado. Feche esta janela e clique em
                "Credenciar".
              </p>
            )}
          </div>

          <Erro msg={erro} />
          <Avisos lista={avisos} />
          {ok && (
            <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800">
              <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
              <span>{ok}</span>
            </div>
          )}

          <Button variant="outline" size="lg" className="w-full h-14 text-base" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

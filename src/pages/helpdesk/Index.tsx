import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogOut,
  Pencil,
  QrCode,
  Search,
  UserPlus,
} from 'lucide-react'
import {
  clearSession,
  getKey,
  getOperador,
  hdBuscar,
  hdLogin,
  HelpdeskAuthError,
  type HDComprador,
  type HDIngresso,
} from '@/lib/helpdesk'
import { AlterarDialog, CredenciarDialog, QrDialog } from '@/components/helpdesk/AcoesDialogs'

// ------------------------------------------------------------------ login

function LoginHelpdesk({ onEntrar }: { onEntrar: () => void }) {
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)

  const entrar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro('')
    if (!nome.trim()) return setErro('Escreva o seu nome.')
    if (!senha.trim()) return setErro('Digite a senha do balcão.')
    setEntrando(true)
    try {
      await hdLogin(senha.trim(), nome.trim())
      onEntrar()
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setEntrando(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 space-y-6 shadow-lg">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold text-slate-900">Help Desk</h1>
          <p className="text-base text-slate-600">Adapta Summit 2026</p>
        </div>

        <form onSubmit={entrar} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="hd-op" className="text-base font-semibold">
              Seu nome
            </Label>
            <Input
              id="hd-op"
              className="h-14 text-lg"
              placeholder="Ex.: Ana"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
            />
            <p className="text-sm text-slate-500">Fica registrado em tudo que você fizer aqui.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hd-senha" className="text-base font-semibold">
              Senha do balcão
            </Label>
            <Input
              id="hd-senha"
              type="password"
              className="h-14 text-lg"
              placeholder="••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>

          {erro && (
            <div className="flex items-start gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
              <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full h-14 text-lg" disabled={entrando}>
            {entrando ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  )
}

// --------------------------------------------------------------- ingresso

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

function LinhaIngresso({
  ing,
  onCredenciar,
  onQr,
  onAlterar,
}: {
  ing: HDIngresso
  onCredenciar: () => void
  onQr: () => void
  onAlterar: () => void
}) {
  const semPessoa = !ing.participante
  const pronto = ing.credenciado && ing.tem_qr

  return (
    <div className="rounded-xl border-2 p-4 sm:p-5 space-y-4 bg-white">
      <div className="flex flex-wrap items-center gap-3">
        <TipoBadge tipo={ing.tipo_ingresso} />
        <span className="text-sm text-slate-500">
          Pedido <span className="font-mono font-semibold text-slate-700">{ing.pedido_id}</span>
        </span>
        {pronto ? (
          <span className="ml-auto inline-flex items-center gap-2 text-base font-semibold text-emerald-700">
            <CheckCircle2 className="w-5 h-5" /> Credencial pronta
          </span>
        ) : semPessoa ? (
          <span className="ml-auto inline-flex items-center gap-2 text-base font-semibold text-rose-700">
            <AlertCircle className="w-5 h-5" /> Ainda não credenciado
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-2 text-base font-semibold text-amber-700">
            <AlertCircle className="w-5 h-5" /> Falta gerar a credencial
          </span>
        )}
      </div>

      {ing.participante ? (
        <div className="text-base text-slate-800">
          <div className="font-semibold text-lg">{ing.participante.nome_completo}</div>
          <div className="text-slate-600 break-all">{ing.participante.email}</div>
          <div className="text-slate-600">
            {ing.participante.cpf}
            {ing.participante.telefone ? ` · ${ing.participante.telefone}` : ''}
          </div>
        </div>
      ) : (
        <div className="text-base text-slate-600">
          Ninguém usou este ingresso ainda. Use o botão <b>Credenciar</b>.
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        {semPessoa ? (
          <Button size="lg" className="h-14 text-base gap-2 sm:flex-1" onClick={onCredenciar}>
            <UserPlus className="w-5 h-5" /> Credenciar
          </Button>
        ) : (
          <Button size="lg" className="h-14 text-base gap-2 sm:flex-1" onClick={onQr}>
            <QrCode className="w-5 h-5" /> {pronto ? 'Ver QR Code' : 'Gerar credencial'}
          </Button>
        )}
        {!semPessoa && (
          <Button
            variant="outline"
            size="lg"
            className="h-14 text-base gap-2 sm:flex-1"
            onClick={onAlterar}
          >
            <Pencil className="w-5 h-5" /> Alterar ingresso
          </Button>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- página

export default function Helpdesk() {
  const [logado, setLogado] = useState(!!getKey())
  const [q, setQ] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [buscou, setBuscou] = useState(false)
  const [erro, setErro] = useState('')
  const [resultados, setResultados] = useState<HDComprador[]>([])
  const [ultimaBusca, setUltimaBusca] = useState('')

  const [credenciar, setCredenciar] = useState<{ ing: HDIngresso; comp: HDComprador } | null>(null)
  const [qrDe, setQrDe] = useState<HDIngresso | null>(null)
  const [alterar, setAlterar] = useState<HDIngresso | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (logado) inputRef.current?.focus()
  }, [logado])

  const sair = () => {
    clearSession()
    setResultados([])
    setBuscou(false)
    setQ('')
    setLogado(false)
  }

  const tratarErro = (e: any) => {
    if (e instanceof HelpdeskAuthError) {
      setLogado(false)
      return
    }
    setErro(e.message)
  }

  const buscar = async (termo?: string) => {
    const alvo = (termo ?? q).trim()
    if (alvo.length < 3) {
      setErro('Digite pelo menos 3 letras ou números para buscar.')
      return
    }
    setErro('')
    setBuscando(true)
    try {
      const res = await hdBuscar(alvo)
      setResultados(res)
      setBuscou(true)
      setUltimaBusca(alvo)
    } catch (e: any) {
      tratarErro(e)
    } finally {
      setBuscando(false)
    }
  }

  const recarregar = () => {
    if (ultimaBusca) buscar(ultimaBusca)
  }

  if (!logado) return <LoginHelpdesk onEntrar={() => setLogado(true)} />

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Help Desk</h1>
            <p className="text-sm text-slate-500">Atendente: {getOperador()}</p>
          </div>
          <Button variant="ghost" size="lg" className="gap-2 h-12" onClick={sair}>
            <LogOut className="w-5 h-5" /> Sair
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <Card className="p-5 space-y-4 shadow-sm">
          <Label htmlFor="hd-busca" className="text-lg font-semibold text-slate-900">
            Buscar pessoa
          </Label>
          <Input
            id="hd-busca"
            ref={inputRef}
            className="h-16 text-xl"
            placeholder="Nome, e-mail, CPF ou telefone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') buscar()
            }}
            autoComplete="off"
          />
          <Button
            size="lg"
            className="w-full h-16 text-lg gap-2"
            onClick={() => buscar()}
            disabled={buscando}
          >
            {buscando ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" /> Buscando...
              </>
            ) : (
              <>
                <Search className="w-6 h-6" /> Buscar
              </>
            )}
          </Button>
          <p className="text-sm text-slate-500">
            Pode digitar só parte do nome ou do e-mail. Também funciona com o número do pedido.
          </p>
        </Card>

        {erro && (
          <div className="flex items-start gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
            <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
            <span>{erro}</span>
          </div>
        )}

        {buscou && resultados.length === 0 && !buscando && (
          <Card className="p-8 text-center space-y-2">
            <p className="text-lg font-semibold text-slate-800">Ninguém encontrado</p>
            <p className="text-base text-slate-600">
              Tente escrever só o primeiro nome, ou buscar pelo e-mail ou CPF.
            </p>
          </Card>
        )}

        {resultados.map((c) => (
          <Card key={c.id} className="p-5 space-y-4 shadow-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                Comprador
              </div>
              <div className="text-xl font-bold text-slate-900">{c.nome}</div>
              <div className="text-base text-slate-600 break-all">{c.email}</div>
              <div className="text-base text-slate-600">
                {[c.documento, c.telefone].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-base font-semibold text-slate-700">
                {c.ingressos.length === 0
                  ? 'Nenhum ingresso neste cadastro'
                  : `${c.ingressos.length} ingresso(s)`}
              </div>
              {c.ingressos.map((ing) => (
                <LinhaIngresso
                  key={ing.id}
                  ing={ing}
                  onCredenciar={() => setCredenciar({ ing, comp: c })}
                  onQr={() => setQrDe(ing)}
                  onAlterar={() => setAlterar(ing)}
                />
              ))}
            </div>
          </Card>
        ))}
      </main>

      <CredenciarDialog
        ingresso={credenciar?.ing || null}
        comprador={credenciar?.comp || null}
        onClose={() => setCredenciar(null)}
        onDone={recarregar}
      />
      <QrDialog ingresso={qrDe} onClose={() => setQrDe(null)} onDone={recarregar} />
      <AlterarDialog ingresso={alterar} onClose={() => setAlterar(null)} onDone={recarregar} />
    </div>
  )
}

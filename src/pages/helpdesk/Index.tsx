import { useEffect, useMemo, useRef, useState } from 'react'
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
  Send,
  Ticket,
  UserPlus,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
import NovoCredenciamentoDialog from '@/components/helpdesk/NovoCredenciamentoDialog'
import ReenviarDialog, { type AlvoReenvio } from '@/components/helpdesk/ReenviarDialog'

// ------------------------------------------------------------------ login

function LoginHelpdesk({
  onEntrar,
  avisoInicial,
}: {
  onEntrar: () => void
  avisoInicial?: string
}) {
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState(avisoInicial || '')
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

// ------------------------------------------------------------------ peças

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

function CardComprador({
  comp,
  ativo,
  onSelecionar,
  onReenviar,
}: {
  comp: HDComprador
  ativo: boolean
  onSelecionar: () => void
  onReenviar: () => void
}) {
  const comCredencial = comp.ingressos.filter((i) => i.credenciado && i.tem_qr).length
  const semCredencial = comp.total_ingressos - comCredencial
  const parcial = !comp.match_comprador && comp.ingressos_encontrados < comp.total_ingressos

  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-white transition-colors',
        ativo
          ? 'border-primary ring-2 ring-primary/25 bg-primary/5'
          : 'border-slate-200 hover:border-slate-300',
      )}
    >
      <button
        type="button"
        onClick={onSelecionar}
        aria-pressed={ativo}
        className="w-full text-left p-4 space-y-2"
      >
        <div className="text-lg font-bold text-slate-900 leading-tight">{comp.nome}</div>
        <div className="text-sm text-slate-600 break-all">{comp.email}</div>
        {(comp.documento || comp.telefone) && (
          <div className="text-sm text-slate-600">
            {[comp.documento, comp.telefone].filter(Boolean).join(' · ')}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline" className="text-sm border-slate-300 bg-slate-50 text-slate-700">
            {comp.total_ingressos} ingresso{comp.total_ingressos === 1 ? '' : 's'}
          </Badge>
          {comCredencial > 0 && (
            <Badge
              variant="outline"
              className="text-sm border-emerald-200 bg-emerald-50 text-emerald-700"
            >
              {comCredencial} com credencial
            </Badge>
          )}
          {semCredencial > 0 && (
            <Badge variant="outline" className="text-sm border-rose-200 bg-rose-50 text-rose-700">
              {semCredencial} sem credencial
            </Badge>
          )}
        </div>

        {parcial && (
          <p className="text-sm text-slate-500">
            {comp.ingressos_encontrados} de {comp.total_ingressos} combinam com a busca
          </p>
        )}
      </button>

      <div className="px-4 pb-4">
        <Button
          variant="outline"
          size="lg"
          className="w-full h-12 text-sm gap-2"
          disabled={!comp.email}
          onClick={onReenviar}
        >
          <Send className="w-4 h-4" />
          {comp.email ? 'Reenviar e-mail de acesso' : 'Sem e-mail cadastrado'}
        </Button>
      </div>
    </div>
  )
}

function CardIngresso({
  ing,
  comp,
  onCredenciar,
  onQr,
  onAlterar,
  onReenviar,
}: {
  ing: HDIngresso
  comp: HDComprador
  onCredenciar: () => void
  onQr: () => void
  onAlterar: () => void
  onReenviar: () => void
}) {
  const semPessoa = !ing.participante
  const pronto = ing.credenciado && ing.tem_qr

  return (
    <div className="rounded-xl border-2 bg-white p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TipoBadge tipo={ing.tipo_ingresso} />
        <span className="text-sm text-slate-500">
          Pedido <span className="font-mono font-semibold text-slate-700">{ing.pedido_id}</span>
        </span>
        {pronto ? (
          <span className="sm:ml-auto inline-flex items-center gap-2 text-base font-semibold text-emerald-700">
            <CheckCircle2 className="w-5 h-5" /> Credencial pronta
          </span>
        ) : semPessoa ? (
          <span className="sm:ml-auto inline-flex items-center gap-2 text-base font-semibold text-rose-700">
            <AlertCircle className="w-5 h-5" /> Ainda não credenciado
          </span>
        ) : (
          <span className="sm:ml-auto inline-flex items-center gap-2 text-base font-semibold text-amber-700">
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

      <div className="rounded-lg bg-slate-50 border px-3 py-2 text-sm text-slate-600">
        Comprado por <span className="font-semibold text-slate-800">{comp.nome}</span>
        {comp.email ? <span className="break-all"> · {comp.email}</span> : null}
      </div>

      {semPessoa ? (
        <Button size="lg" className="w-full h-14 text-base gap-2" onClick={onCredenciar}>
          <UserPlus className="w-5 h-5" /> Credenciar
        </Button>
      ) : (
        <div className="space-y-3">
          <Button size="lg" className="w-full h-14 text-base gap-2" onClick={onQr}>
            <QrCode className="w-5 h-5" /> {pronto ? 'Ver QR Code' : 'Gerar credencial'}
          </Button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="lg"
              className="h-14 text-base gap-2"
              onClick={onAlterar}
            >
              <Pencil className="w-5 h-5" /> Alterar ingresso
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-14 text-base gap-2"
              disabled={!ing.participante?.email}
              onClick={onReenviar}
            >
              <Send className="w-5 h-5" /> Reenviar ingresso
            </Button>
          </div>
        </div>
      )}
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
  const [motivoSaida, setMotivoSaida] = useState('')
  const [resultados, setResultados] = useState<HDComprador[]>([])
  const [ultimaBusca, setUltimaBusca] = useState('')
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(false)

  const [credenciar, setCredenciar] = useState<{ ing: HDIngresso; comp: HDComprador } | null>(null)
  const [qrDe, setQrDe] = useState<HDIngresso | null>(null)
  const [alterar, setAlterar] = useState<HDIngresso | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [reenvio, setReenvio] = useState<AlvoReenvio | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const painelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logado) inputRef.current?.focus()
  }, [logado])

  const sair = () => {
    clearSession()
    setResultados([])
    setBuscou(false)
    setQ('')
    setMotivoSaida('')
    setLogado(false)
  }

  // Nada de erro sem explicação: se a senha for recusada no meio do
  // atendimento, o motivo aparece na tela de entrada.
  const tratarErro = (e: any) => {
    if (e instanceof HelpdeskAuthError) {
      setMotivoSaida(
        `${e.message} Se a senha do balcão foi trocada agora, peça a nova para o responsável.`,
      )
      setResultados([])
      setBuscou(false)
      setLogado(false)
      return
    }
    setErro(e?.message || 'Algo falhou e o sistema não recebeu o motivo. Chame o suporte.')
  }

  const buscar = async (termo?: string, preservarSelecao = false) => {
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
      if (preservarSelecao) {
        setSelecionado((atual) =>
          atual && res.some((c) => c.id === atual) ? atual : res.length === 1 ? res[0].id : null,
        )
      } else {
        setSelecionado(res.length === 1 ? res[0].id : null)
        setVerTodos(false)
      }
    } catch (e: any) {
      tratarErro(e)
    } finally {
      setBuscando(false)
    }
  }

  const recarregar = () => {
    if (ultimaBusca) buscar(ultimaBusca, true)
  }

  // No celular as colunas viram uma só: ao escolher o comprador, leva a tela
  // até os ingressos dele para o atendente não ter que caçar onde mudou.
  const selecionarComprador = (id: string) => {
    setSelecionado((atual) => (atual === id ? null : id))
    setVerTodos(false)
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setTimeout(() => {
        painelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 60)
    }
  }

  const compradoresVisiveis = useMemo(
    () => (selecionado ? resultados.filter((c) => c.id === selecionado) : resultados),
    [resultados, selecionado],
  )

  const itens = useMemo(() => {
    const lista: { ing: HDIngresso; comp: HDComprador }[] = []
    for (const c of compradoresVisiveis) {
      for (const ing of c.ingressos) {
        if (verTodos || ing.match) lista.push({ ing, comp: c })
      }
    }
    return lista
  }, [compradoresVisiveis, verTodos])

  const totalDosVisiveis = compradoresVisiveis.reduce((n, c) => n + c.total_ingressos, 0)
  const totalQueCombinam = compradoresVisiveis.reduce((n, c) => n + c.ingressos_encontrados, 0)
  const podeExpandir = totalDosVisiveis > totalQueCombinam
  const compradorAtivo = selecionado ? compradoresVisiveis[0] : null

  if (!logado) {
    return (
      <LoginHelpdesk
        avisoInicial={motivoSaida}
        onEntrar={() => {
          setMotivoSaida('')
          setErro('')
          setLogado(true)
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Help Desk</h1>
            <p className="text-sm text-slate-500">Atendente: {getOperador()}</p>
          </div>
          <Button variant="ghost" size="lg" className="gap-2 h-12" onClick={sair}>
            <LogOut className="w-5 h-5" /> Sair
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Card className="p-5 space-y-4 shadow-sm">
          <div className="flex flex-col lg:flex-row gap-4 lg:items-end">
            <div className="flex-1 space-y-2">
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
            </div>
            <Button
              size="lg"
              className="h-16 text-lg gap-2 lg:w-52"
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
          </div>
          <p className="text-sm text-slate-500">
            Pode digitar só parte do nome ou do e-mail. Também funciona com o número do pedido.
          </p>

          <div className="border-t pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-base text-slate-700 sm:flex-1">A pessoa não está no sistema?</p>
            <Button
              variant="outline"
              size="lg"
              className="h-14 text-base gap-2 sm:w-64"
              onClick={() => setNovoAberto(true)}
            >
              <UserPlus className="w-5 h-5" /> Novo credenciamento
            </Button>
          </div>
        </Card>

        {erro && (
          <div className="flex items-start gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base text-rose-800">
            <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
            <span>{erro}</span>
          </div>
        )}

        {buscou && resultados.length === 0 && !buscando && (
          <Card className="p-8 text-center space-y-4">
            <div className="space-y-2">
              <p className="text-lg font-semibold text-slate-800">Ninguém encontrado</p>
              <p className="text-base text-slate-600">
                Tente escrever só o primeiro nome, ou buscar pelo e-mail ou CPF. Se a pessoa
                realmente não estiver no sistema, faça um credenciamento novo.
              </p>
            </div>
            <Button
              size="lg"
              className="w-full sm:w-auto sm:mx-auto h-14 text-base gap-2 px-8"
              onClick={() => setNovoAberto(true)}
            >
              <UserPlus className="w-5 h-5" /> Novo credenciamento
            </Button>
          </Card>
        )}

        {resultados.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] items-start">
            {/* ---------------- coluna 1: compradores ---------------- */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  <Users className="w-4 h-4" /> Compradores ({resultados.length})
                </h2>
                {selecionado && resultados.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 text-sm"
                    onClick={() => {
                      setSelecionado(null)
                      setVerTodos(false)
                    }}
                  >
                    Ver todos
                  </Button>
                )}
              </div>

              <div className="space-y-3 lg:sticky lg:top-28 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1">
                {resultados.map((c) => (
                  <CardComprador
                    key={c.id}
                    comp={c}
                    ativo={selecionado === c.id}
                    onSelecionar={() => selecionarComprador(c.id)}
                    onReenviar={() =>
                      setReenvio({
                        tipo: 'comprador',
                        id: c.id,
                        nome: c.nome,
                        email: c.email,
                        contexto: `${c.total_ingressos} ingresso${
                          c.total_ingressos === 1 ? '' : 's'
                        } neste cadastro`,
                      })
                    }
                  />
                ))}
                {resultados.length > 1 && (
                  <p className="text-sm text-slate-500 px-1">
                    Toque em um comprador para ver só os ingressos dele.
                  </p>
                )}
              </div>
            </section>

            {/* ---------------- coluna 2: participantes ---------------- */}
            <section ref={painelRef} className="space-y-3 scroll-mt-24">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
                  <Ticket className="w-4 h-4" /> Participantes ({itens.length})
                </h2>
                {podeExpandir && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-sm"
                    onClick={() => setVerTodos((v) => !v)}
                  >
                    {verTodos
                      ? 'Mostrar só quem combina com a busca'
                      : `Ver todos os ${totalDosVisiveis} ingressos`}
                  </Button>
                )}
              </div>

              <p className="text-sm text-slate-500">
                {compradorAtivo ? (
                  <>
                    Ingressos de <b className="text-slate-700">{compradorAtivo.nome}</b>
                    {!verTodos && podeExpandir ? ` que combinam com "${ultimaBusca}"` : ''}
                  </>
                ) : verTodos ? (
                  'Todos os ingressos dos compradores encontrados.'
                ) : (
                  <>
                    Só os ingressos que combinam com <b className="text-slate-700">{ultimaBusca}</b>
                    .
                  </>
                )}
              </p>

              {itens.length === 0 ? (
                <Card className="p-8 text-center space-y-4">
                  <p className="text-base text-slate-600">
                    Este comprador não tem nenhum ingresso no sistema.
                  </p>
                  <Button
                    size="lg"
                    className="h-14 text-base gap-2 px-8"
                    onClick={() => setNovoAberto(true)}
                  >
                    <UserPlus className="w-5 h-5" /> Novo credenciamento
                  </Button>
                </Card>
              ) : (
                <div className="space-y-3">
                  {itens.map(({ ing, comp }) => (
                    <CardIngresso
                      key={ing.id}
                      ing={ing}
                      comp={comp}
                      onCredenciar={() => setCredenciar({ ing, comp })}
                      onQr={() => setQrDe(ing)}
                      onAlterar={() => setAlterar(ing)}
                      onReenviar={() =>
                        setReenvio({
                          tipo: 'participante',
                          id: ing.id,
                          nome: ing.participante?.nome_completo || '',
                          email: ing.participante?.email || '',
                          contexto: `Pedido ${ing.pedido_id} · ${ing.tipo_ingresso}`,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <CredenciarDialog
        ingresso={credenciar?.ing || null}
        comprador={credenciar?.comp || null}
        onClose={() => setCredenciar(null)}
        onDone={recarregar}
      />
      <QrDialog ingresso={qrDe} onClose={() => setQrDe(null)} onDone={recarregar} />
      <AlterarDialog ingresso={alterar} onClose={() => setAlterar(null)} onDone={recarregar} />
      <NovoCredenciamentoDialog
        aberto={novoAberto}
        onClose={() => setNovoAberto(false)}
        onDone={recarregar}
      />
      <ReenviarDialog alvo={reenvio} onClose={() => setReenvio(null)} onDone={() => {}} />
    </div>
  )
}

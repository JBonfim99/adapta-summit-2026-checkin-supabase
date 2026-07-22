import { useState, useMemo } from 'react'
import { UploadCloud, FileType, AlertTriangle, Download, Trash2, UserPlus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'

type Step = 'upload' | 'processing' | 'done'

// Espera um CSV com colunas: nome,email,cpf_cnpj,uf,cidade,telefone,categorias,ingressos,total_pago,ultima_compra
// (mesmo formato do export "participantes-adapta-summit"). Só usa nome, email,
// cpf_cnpj, categorias e ingressos.
export default function AdminReconciliar() {
  const [step, setStep] = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [resultado, setResultado] = useState<any>(null)
  const [apagando, setApagando] = useState(false)
  const [apagarProgress, setApagarProgress] = useState(0)
  const [resultadoApagar, setResultadoApagar] = useState<any>(null)
  const [criando, setCriando] = useState(false)
  const [criarProgress, setCriarProgress] = useState(0)
  const [resultadoCriar, setResultadoCriar] = useState<any>(null)
  // Guarda a linha completa do CSV por email (uf/cidade/telefone), que o
  // endpoint de reconciliação não devolve mas é preciso pra criar o comprador.
  const [dadosPorEmail, setDadosPorEmail] = useState<Record<string, any>>({})
  const { toast } = useToast()

  // Candidatos seguros pra apagar: ingressos EXTRAS (além do esperado) de
  // linhas "excesso", que estão Pendente e sem nada vinculado (sem
  // participante, sem inac_id) — não afetam ninguém que já usou o ingresso.
  // Ordenados do mais recente pro mais antigo (a duplicação de hoje primeiro).
  const candidatosSeguros = useMemo(() => {
    if (!resultado) return []
    const candidatos: any[] = []
    for (const a of resultado.anomalias) {
      if (a.classificacao !== 'excesso') continue
      const ordenados = [...a.tickets].sort((x: any, y: any) => (x.created < y.created ? -1 : 1))
      const extras = ordenados.slice(a.esperado)
      for (const t of extras) {
        if (t.status === 'Pendente' && !t.participante_id && !t.inac_id) {
          candidatos.push({ ...t, nome: a.nome, email: a.email })
        }
      }
    }
    candidatos.sort((x, y) => (x.created < y.created ? 1 : -1))
    return candidatos
  }, [resultado])

  // Compradores que estão no CSV de referência mas não existem no sistema.
  const naoEncontrados = useMemo(() => {
    if (!resultado) return []
    return resultado.anomalias.filter(
      (a: any) => a.classificacao === 'comprador_nao_encontrado' && a.email,
    )
  }, [resultado])

  const parseCSVLine = (text: string) => {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (char === '"' && text[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
    result.push(current)
    return result
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const allLines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

      if (allLines.length < 2) {
        throw new Error('O arquivo CSV deve conter cabeçalho + pelo menos uma linha.')
      }

      const headers = parseCSVLine(allLines[0]).map((h) => h.trim().toLowerCase())
      const idx = {
        nome: headers.indexOf('nome'),
        email: headers.indexOf('email'),
        cpf: headers.indexOf('cpf_cnpj'),
        uf: headers.indexOf('uf'),
        cidade: headers.indexOf('cidade'),
        telefone: headers.indexOf('telefone'),
        categorias: headers.indexOf('categorias'),
        ingressos: headers.indexOf('ingressos'),
      }
      if (idx.email === -1 || idx.ingressos === -1) {
        throw new Error(
          'CSV precisa ter pelo menos as colunas "email" e "ingressos" (esperado: nome,email,cpf_cnpj,uf,cidade,telefone,categorias,ingressos,total_pago,ultima_compra).',
        )
      }

      const linhas = allLines.slice(1).map((line) => {
        const cols = parseCSVLine(line)
        return {
          nome: idx.nome !== -1 ? cols[idx.nome]?.trim() : '',
          email: idx.email !== -1 ? cols[idx.email]?.trim().toLowerCase() : '',
          cpf: idx.cpf !== -1 ? cols[idx.cpf]?.trim() : '',
          uf: idx.uf !== -1 ? cols[idx.uf]?.trim() : '',
          cidade: idx.cidade !== -1 ? cols[idx.cidade]?.trim() : '',
          telefone: idx.telefone !== -1 ? cols[idx.telefone]?.trim() : '',
          categorias: idx.categorias !== -1 ? cols[idx.categorias]?.trim() : '',
          ingressos_esperado: idx.ingressos !== -1 ? parseInt(cols[idx.ingressos], 10) || 0 : 0,
        }
      })

      // Agrupa por email: se o mesmo email aparecer em mais de uma linha
      // (ex: comprador comprou em ocasiões diferentes), soma o "ingressos"
      // de todas e compara UMA vez — em vez de comparar cada linha
      // separadamente contra o total atual do comprador (o que infla
      // "excesso" artificialmente pra quem tem linha duplicada).
      const porEmail = new Map<string, any>()
      for (const linha of linhas) {
        const chave = linha.email || `__sem-email__${linha.cpf}`
        const existente = porEmail.get(chave)
        if (!existente) {
          porEmail.set(chave, { ...linha })
        } else {
          existente.ingressos_esperado += linha.ingressos_esperado
          if (!existente.categorias.includes(linha.categorias)) {
            existente.categorias = existente.categorias
              ? `${existente.categorias} / ${linha.categorias}`
              : linha.categorias
          }
        }
      }
      const rows = Array.from(porEmail.values())

      const mapa: Record<string, any> = {}
      for (const r of rows) if (r.email) mapa[r.email] = r
      setDadosPorEmail(mapa)
      setResultadoCriar(null)

      await processarLotes(rows)
    } catch (err: any) {
      toast({ title: 'Erro ao ler arquivo', description: err.message, variant: 'destructive' })
    }
    e.target.value = ''
  }

  const processarLotes = async (rows: any[]) => {
    setStep('processing')
    setProgress(0)

    const CHUNK = 200
    const totalChunks = Math.max(1, Math.ceil(rows.length / CHUNK))
    const acumulado = {
      classificacoes: { ok: 0, excesso: 0, faltando: 0, comprador_nao_encontrado: 0 },
      anomalias: [] as any[],
      totalLinhas: rows.length,
    }

    try {
      for (let c = 0; c < totalChunks; c++) {
        const chunk = rows.slice(c * CHUNK, (c + 1) * CHUNK)
        const res: any = await pb.send('/backend/v1/admin/reconciliar-ingressos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        })
        acumulado.classificacoes.ok += res.classificacoes?.ok || 0
        acumulado.classificacoes.excesso += res.classificacoes?.excesso || 0
        acumulado.classificacoes.faltando += res.classificacoes?.faltando || 0
        acumulado.classificacoes.comprador_nao_encontrado +=
          res.classificacoes?.comprador_nao_encontrado || 0
        acumulado.anomalias.push(...(res.anomalias || []))
        setProgress(Math.round(((c + 1) / totalChunks) * 100))
      }
      setResultado(acumulado)
      setStep('done')
    } catch (err: any) {
      toast({ title: 'Erro na reconciliação', description: err.message, variant: 'destructive' })
      setStep('upload')
    }
  }

  const handleApagarSeguros = async () => {
    const alvo = candidatosSeguros
    if (alvo.length === 0) return
    setApagando(true)
    setApagarProgress(0)
    const res = { ok: 0, falhou: 0, erros: [] as any[] }
    for (let i = 0; i < alvo.length; i++) {
      try {
        const r: any = await pb.send(`/backend/v1/admin/tickets/${alvo[i].id}/delete`, {
          method: 'POST',
        })
        if (r.success) res.ok++
        else {
          res.falhou++
          res.erros.push({ ...alvo[i], erro: r.error })
        }
      } catch (err: any) {
        res.falhou++
        res.erros.push({ ...alvo[i], erro: err.message })
      }
      setApagarProgress(Math.round(((i + 1) / alvo.length) * 100))
    }
    setResultadoApagar(res)
    setApagando(false)
    toast({
      title: 'Limpeza concluída',
      description: `${res.ok} apagado(s), ${res.falhou} com erro (de ${alvo.length} tentados).`,
    })
  }

  const handleCriarFaltantes = async () => {
    const alvo = naoEncontrados
    if (alvo.length === 0) return
    setCriando(true)
    setCriarProgress(0)

    const payload = alvo.map((a: any) => {
      const extra = dadosPorEmail[a.email] || {}
      return {
        nome: a.nome || extra.nome || '',
        email: a.email,
        cpf: a.cpf || extra.cpf || '',
        uf: extra.uf || '',
        cidade: extra.cidade || '',
        telefone: extra.telefone || '',
        categorias: a.categorias || extra.categorias || '',
        ingressos_esperado: a.esperado,
      }
    })

    const CHUNK = 50
    const totalChunks = Math.max(1, Math.ceil(payload.length / CHUNK))
    const acc = {
      criados: 0,
      ingressos_criados: 0,
      ja_existiam: 0,
      indefinidos: [] as any[],
      erros: [] as any[],
    }

    try {
      for (let c = 0; c < totalChunks; c++) {
        const chunk = payload.slice(c * CHUNK, (c + 1) * CHUNK)
        const res: any = await pb.send('/backend/v1/admin/reconciliar-criar-compradores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        })
        acc.criados += res.criados || 0
        acc.ingressos_criados += res.ingressos_criados || 0
        acc.ja_existiam += res.ja_existiam || 0
        acc.indefinidos.push(...(res.indefinidos || []))
        acc.erros.push(...(res.erros || []))
        setCriarProgress(Math.round(((c + 1) / totalChunks) * 100))
      }
      setResultadoCriar(acc)
      toast({
        title: 'Criação concluída',
        description: `${acc.criados} comprador(es) criado(s) com ${acc.ingressos_criados} ingresso(s).`,
      })
    } catch (err: any) {
      toast({
        title: 'Erro ao criar compradores',
        description: err.message,
        variant: 'destructive',
      })
    }
    setCriando(false)
  }

  const baixarJSON = (dados: any, prefixo: string) => {
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${prefixo}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const baixarAnomalias = () => {
    const blob = new Blob([JSON.stringify(resultado.anomalias, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reconciliacao-anomalias-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up pb-12">
      <div>
        <h2 className="text-2xl font-bold">Reconciliar Ingressos</h2>
        <p className="text-muted-foreground">
          Compara, por comprador, o total de ingressos no sistema com o total esperado numa planilha
          de referência. Só leitura — não altera nada.
        </p>
      </div>

      {step === 'upload' && (
        <Card className="border-dashed border-2 bg-slate-50/50">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <div
              className={`space-y-4 p-8 w-full rounded-xl transition-colors relative ${isDragging ? 'bg-primary/5 border-primary' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
              }}
            >
              <input
                type="file"
                accept=".csv"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileUpload}
              />
              <div className="bg-white p-4 rounded-full shadow-sm inline-block mb-2 pointer-events-none">
                <UploadCloud className="h-10 w-10 text-accent" />
              </div>
              <h3 className="text-lg font-semibold pointer-events-none">
                Selecione o CSV de referência
              </h3>
              <p className="text-sm text-muted-foreground mb-2 pointer-events-none">
                Colunas esperadas: nome, email, cpf_cnpj, categorias, ingressos
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'processing' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <div className="w-full max-w-md space-y-4 animate-fade-in">
              <FileType className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Comparando...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'done' && resultado && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
            <CardDescription>{resultado.totalLinhas} linha(s) comparadas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="grid grid-cols-2 gap-4 text-sm text-slate-700">
              <li className="flex items-center gap-2 p-3 bg-emerald-50 rounded border border-emerald-200">
                <div>
                  <div className="text-xs text-muted-foreground">OK (bate certinho)</div>
                  <div className="font-bold text-lg text-emerald-700">
                    {resultado.classificacoes.ok}
                  </div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-rose-50 rounded border border-rose-200">
                <div>
                  <div className="text-xs text-muted-foreground">Excesso (sobrando ingresso)</div>
                  <div className="font-bold text-lg text-rose-700">
                    {resultado.classificacoes.excesso}
                  </div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-amber-50 rounded border border-amber-200">
                <div>
                  <div className="text-xs text-muted-foreground">Faltando ingresso</div>
                  <div className="font-bold text-lg text-amber-700">
                    {resultado.classificacoes.faltando}
                  </div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-slate-100 rounded border">
                <div>
                  <div className="text-xs text-muted-foreground">Comprador não encontrado</div>
                  <div className="font-bold text-lg text-slate-700">
                    {resultado.classificacoes.comprador_nao_encontrado}
                  </div>
                </div>
              </li>
            </ul>

            {resultado.anomalias.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  {resultado.anomalias.length} linha(s) com divergência. Baixe o JSON pra ver o
                  detalhe de cada uma (com os ingressos exatos envolvidos) antes de decidir o que
                  ajustar.
                </div>
              </div>
            )}

            <Button
              onClick={baixarAnomalias}
              className="gap-2"
              disabled={!resultado.anomalias.length}
            >
              <Download className="w-4 h-4" /> Baixar anomalias (JSON)
            </Button>

            {candidatosSeguros.length > 0 && (
              <div className="mt-6 p-4 rounded border border-rose-200 bg-rose-50/50 space-y-3">
                <div className="text-sm font-semibold text-rose-900">
                  Limpar ingressos-fantasma (Pendente, sem participante, sem INAC)
                </div>
                <div className="text-sm text-slate-600">
                  {candidatosSeguros.length} ingresso(s) extra(s) — por pessoa, o que passar do que
                  o CSV diz que ela deveria ter. Apaga todos de uma vez pra deixar cada comprador
                  1:1 com o CSV (os "arriscados" ficam de fora, precisam de revisão manual).
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="destructive"
                    className="gap-2"
                    onClick={handleApagarSeguros}
                    disabled={apagando}
                  >
                    <Trash2 className="w-4 h-4" />
                    {apagando
                      ? 'Apagando...'
                      : `Apagar todos os ${candidatosSeguros.length} seguros`}
                  </Button>
                </div>
                {apagando && <Progress value={apagarProgress} className="h-2" />}
                {resultadoApagar && (
                  <div className="text-sm text-slate-700">
                    {resultadoApagar.ok} apagado(s) com sucesso
                    {resultadoApagar.falhou > 0 ? `, ${resultadoApagar.falhou} com erro` : ''}.
                  </div>
                )}
              </div>
            )}

            {naoEncontrados.length > 0 && (
              <div className="mt-6 p-4 rounded border border-sky-200 bg-sky-50/50 space-y-3">
                <div className="text-sm font-semibold text-sky-900">
                  Criar quem ainda não existe
                </div>
                <div className="text-sm text-slate-600">
                  {naoEncontrados.length} comprador(es) estão no CSV de referência mas não existem
                  no sistema. Cria cada um já com os ingressos dele (status Pendente e link de
                  participante gerado). Não dispara e-mail de acesso — isso continua sendo um passo
                  separado. Pode rodar de novo sem medo: quem já existir é ignorado.
                </div>
                <div className="flex items-center gap-3">
                  <Button className="gap-2" onClick={handleCriarFaltantes} disabled={criando}>
                    <UserPlus className="w-4 h-4" />
                    {criando ? 'Criando...' : `Criar os ${naoEncontrados.length} compradores`}
                  </Button>
                </div>
                {criando && <Progress value={criarProgress} className="h-2" />}
                {resultadoCriar && (
                  <div className="text-sm text-slate-700 space-y-2">
                    <div>
                      {resultadoCriar.criados} comprador(es) criado(s) com{' '}
                      {resultadoCriar.ingressos_criados} ingresso(s)
                      {resultadoCriar.ja_existiam > 0
                        ? `, ${resultadoCriar.ja_existiam} já existia(m)`
                        : ''}
                      {resultadoCriar.erros.length > 0
                        ? `, ${resultadoCriar.erros.length} com erro`
                        : ''}
                      .
                    </div>
                    {resultadoCriar.indefinidos.length > 0 && (
                      <div className="flex items-start gap-2 p-3 rounded border border-amber-200 bg-amber-50 text-amber-800">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div className="space-y-2">
                          <div>
                            {resultadoCriar.indefinidos.length} comprador(es) NÃO foram criados: o
                            CSV diz categoria mista (Gold + Platinum) com 3 ou mais ingressos, e não
                            dá pra saber quantos são de cada. Confira na origem e crie na mão —
                            criar com a categoria errada credenciaria a pessoa errada no dia.
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() =>
                              baixarJSON(resultadoCriar.indefinidos, 'criar-indefinidos')
                            }
                          >
                            <Download className="w-4 h-4" /> Baixar indefinidos (JSON)
                          </Button>
                        </div>
                      </div>
                    )}
                    {resultadoCriar.erros.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => baixarJSON(resultadoCriar.erros, 'criar-erros')}
                      >
                        <Download className="w-4 h-4" /> Baixar erros (JSON)
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

import { useState } from 'react'
import { UploadCloud, FileType, AlertTriangle, Download } from 'lucide-react'
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
  const { toast } = useToast()

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
        categorias: headers.indexOf('categorias'),
        ingressos: headers.indexOf('ingressos'),
      }
      if (idx.email === -1 || idx.ingressos === -1) {
        throw new Error(
          'CSV precisa ter pelo menos as colunas "email" e "ingressos" (esperado: nome,email,cpf_cnpj,uf,cidade,telefone,categorias,ingressos,total_pago,ultima_compra).',
        )
      }

      const rows = allLines.slice(1).map((line) => {
        const cols = parseCSVLine(line)
        return {
          nome: idx.nome !== -1 ? cols[idx.nome]?.trim() : '',
          email: idx.email !== -1 ? cols[idx.email]?.trim() : '',
          cpf: idx.cpf !== -1 ? cols[idx.cpf]?.trim() : '',
          categorias: idx.categorias !== -1 ? cols[idx.categorias]?.trim() : '',
          ingressos_esperado: idx.ingressos !== -1 ? parseInt(cols[idx.ingressos], 10) || 0 : 0,
        }
      })

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
          </CardContent>
        </Card>
      )}
    </div>
  )
}

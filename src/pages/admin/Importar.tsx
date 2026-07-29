import { useState } from 'react'
import { UploadCloud, FileType, ArrowRight, AlertTriangle } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/backend/client'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

type Step = 'upload' | 'mapping' | 'summary' | 'importing'

export default function AdminImport() {
  const [step, setStep] = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [headers, setHeaders] = useState<string[]>([])
  const [lines, setLines] = useState<string[]>([])
  const [sendEmail, setSendEmail] = useState(false)
  const { toast } = useToast()

  const [mapping, setMapping] = useState({
    nome: '',
    email: '',
    documento: '',
    uf: '',
    cidade: '',
    telefone: '',
    qtd_gold: '',
    qtd_platinum: '',
    qtd_palestrantes: '',
    qtd_hackathon: '',
  })

  const [summary, setSummary] = useState({
    totalRows: 0,
    uniqueBuyers: 0,
    goldTickets: 0,
    platinumTickets: 0,
    palestrantesTickets: 0,
    hackathonTickets: 0,
    payloadRows: [] as any[],
    skippedNoEmail: 0,
  })

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
        throw new Error(
          'O arquivo CSV deve conter pelo menos uma linha de cabeçalho e uma de dados.',
        )
      }

      const csvHeaders = parseCSVLine(allLines[0]).map((h) => h.trim())
      setHeaders(csvHeaders)
      setLines(allLines.slice(1))

      const autoMap = { ...mapping }
      const lowerHeaders = csvHeaders.map((h) => h.toLowerCase())

      const findIndex = (search: string[]) => {
        for (const s of search) {
          const idx = lowerHeaders.findIndex((h) => h.includes(s))
          if (idx !== -1) return csvHeaders[idx]
        }
        return ''
      }

      autoMap.nome = findIndex(['nome', 'name'])
      autoMap.email = findIndex(['email', 'e-mail'])
      autoMap.documento = findIndex(['documento', 'cpf', 'cnpj'])
      autoMap.uf = findIndex(['uf', 'estado'])
      autoMap.cidade = findIndex(['cidade', 'city'])
      autoMap.telefone = findIndex(['telefone', 'celular', 'phone'])
      autoMap.qtd_gold = findIndex(['gold', 'qtd gold'])
      autoMap.qtd_platinum = findIndex(['platinum', 'qtd platinum'])
      autoMap.qtd_palestrantes = findIndex(['palestrantes', 'palestrante', 'qtd palestrantes'])
      autoMap.qtd_hackathon = findIndex(['hackathon', 'qtd hackathon'])

      setMapping(autoMap)
      setStep('mapping')
    } catch (err: any) {
      toast({ title: 'Erro ao ler arquivo', description: err.message, variant: 'destructive' })
    }
    e.target.value = ''
  }

  const handleMapSubmit = () => {
    if (!mapping.email) {
      toast({
        title: 'Atenção',
        description:
          'Você deve mapear pelo menos o Email — é por ele que a importação agrupa os compradores.',
        variant: 'destructive',
      })
      return
    }

    const emailIdx = headers.indexOf(mapping.email)
    const docIdx = headers.indexOf(mapping.documento)
    const nomeIdx = headers.indexOf(mapping.nome)
    const ufIdx = headers.indexOf(mapping.uf)
    const cidIdx = headers.indexOf(mapping.cidade)
    const telIdx = headers.indexOf(mapping.telefone)
    const goldIdx = headers.indexOf(mapping.qtd_gold)
    const platIdx = headers.indexOf(mapping.qtd_platinum)
    const palIdx = headers.indexOf(mapping.qtd_palestrantes)
    const hackIdx = headers.indexOf(mapping.qtd_hackathon)

    const payloadRows = []
    const buyersSet = new Set()
    let goldTickets = 0
    let platinumTickets = 0
    let palestrantesTickets = 0
    let hackathonTickets = 0
    let skippedNoEmail = 0

    for (const line of lines) {
      const cols = parseCSVLine(line)
      const doc = docIdx !== -1 ? cols[docIdx]?.trim() : ''
      const email = emailIdx !== -1 ? cols[emailIdx]?.trim() : ''

      // Mesma regra do backend: agrupa/deduplica por e-mail (case-insensitive)
      // e ignora qualquer linha sem e-mail.
      if (!email) {
        skippedNoEmail++
        continue
      }

      buyersSet.add(email.toLowerCase())
      const g = goldIdx !== -1 ? parseInt(cols[goldIdx] || '0', 10) || 0 : 0
      const p = platIdx !== -1 ? parseInt(cols[platIdx] || '0', 10) || 0 : 0
      const pal = palIdx !== -1 ? parseInt(cols[palIdx] || '0', 10) || 0 : 0
      const hack = hackIdx !== -1 ? parseInt(cols[hackIdx] || '0', 10) || 0 : 0

      goldTickets += g
      platinumTickets += p
      palestrantesTickets += pal
      hackathonTickets += hack

      payloadRows.push({
        documento: doc,
        email,
        nome: nomeIdx !== -1 ? cols[nomeIdx]?.trim() : '',
        uf: ufIdx !== -1 ? cols[ufIdx]?.trim() : '',
        cidade: cidIdx !== -1 ? cols[cidIdx]?.trim() : '',
        telefone: telIdx !== -1 ? cols[telIdx]?.trim() : '',
        qtd_gold: g,
        qtd_platinum: p,
        qtd_palestrantes: pal,
        qtd_hackathon: hack,
      })
    }

    setSummary({
      totalRows: payloadRows.length,
      uniqueBuyers: buyersSet.size,
      goldTickets,
      platinumTickets,
      palestrantesTickets,
      hackathonTickets,
      payloadRows,
      skippedNoEmail,
    })
    setStep('summary')
  }

  const handleConfirmImport = async () => {
    setStep('importing')
    setProgress(0)

    // Importa em LOTES (cada lote = sua própria transação no servidor). Isso
    // evita timeout/rollback de uma única requisição gigante e dá progresso real.
    // E-mail repetido entre lotes é tratado no backend (reusa o comprador).
    const rows = summary.payloadRows
    const CHUNK = 200
    const totalChunks = Math.max(1, Math.ceil(rows.length / CHUNK))
    let importedTotal = 0
    let emailAtivo = sendEmail
    let emailDisparoId = ''
    let emailQueuedTotal = 0
    let emailSkipReason = ''

    try {
      for (let c = 0; c < totalChunks; c++) {
        const chunk = rows.slice(c * CHUNK, (c + 1) * CHUNK)
        const res: any = await pb.send('/backend/v1/admin/import-buyers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: chunk,
            enviar_email: emailAtivo,
            disparo_id: emailDisparoId,
          }),
        })
        importedTotal += res.imported || 0
        if (emailAtivo && res.email) {
          if (res.email.skipped) {
            emailAtivo = false
            emailSkipReason = res.email.reason || 'e-mail não enviado'
          } else {
            if (res.email.disparo_id) emailDisparoId = res.email.disparo_id
            emailQueuedTotal += res.email.queued || 0
          }
        }
        setProgress(Math.round(((c + 1) / totalChunks) * 100))
      }

      setTimeout(() => {
        setStep('upload')
        setProgress(0)
        setSendEmail(false)
        let desc = `Sucesso! ${importedTotal} ingressos gerados.`
        if (sendEmail) {
          desc += emailSkipReason
            ? ` E-mails NÃO enviados: ${emailSkipReason}.`
            : ` ${emailQueuedTotal} comprador(es) entraram na fila de e-mail.`
        }
        toast({ title: 'Importação concluída', description: desc })
      }, 500)
    } catch (err: any) {
      setStep('summary')
      toast({
        title: 'Erro na Importação',
        description: `${err.message}. ${importedTotal} ingressos foram importados antes da falha — confira o total e, se precisar recomeçar do zero, limpe os dados e reimporte.`,
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up pb-12">
      <div>
        <h2 className="text-2xl font-bold">Importar Compradores</h2>
        <p className="text-muted-foreground">
          Importe os compradores e gere os ingressos automaticamente.
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
                Selecione ou Arraste seu CSV
              </h3>
              <p className="text-sm text-muted-foreground mb-6 pointer-events-none">
                Suporta .csv até 10MB
              </p>
              <Button type="button" className="bg-primary hover:bg-primary/90 pointer-events-none">
                Procurar Arquivo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'mapping' && (
        <Card>
          <CardHeader>
            <CardTitle>Mapeamento de Colunas</CardTitle>
            <CardDescription>
              Vincule as colunas do seu CSV com os campos do sistema.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.keys(mapping).map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="capitalize">
                    {key.replace('_', ' ')} {key === 'email' && '*'}
                  </Label>
                  <Select
                    value={(mapping as any)[key]}
                    onValueChange={(val) => setMapping((prev) => ({ ...prev, [key]: val }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a coluna" />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setStep('upload')}>
              Voltar
            </Button>
            <Button onClick={handleMapSubmit} className="gap-2">
              Avançar <ArrowRight className="w-4 h-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 'summary' && (
        <Card>
          <CardHeader>
            <CardTitle>Resumo da Importação</CardTitle>
            <CardDescription>Verifique os dados antes de confirmar a importação.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="grid grid-cols-2 gap-4 text-sm text-slate-700">
              <li className="flex items-center gap-2 p-3 bg-slate-50 rounded border">
                <div>
                  <div className="text-xs text-muted-foreground">Linhas a importar</div>
                  <div className="font-bold text-lg">{summary.totalRows}</div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-slate-50 rounded border">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Compradores únicos (por e-mail)
                  </div>
                  <div className="font-bold text-lg">{summary.uniqueBuyers}</div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-slate-50 rounded border">
                <div>
                  <div className="text-xs text-muted-foreground">Ingressos GOLD</div>
                  <div className="font-bold text-lg text-amber-600">{summary.goldTickets}</div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-slate-50 rounded border">
                <div>
                  <div className="text-xs text-muted-foreground">Ingressos PLATINUM</div>
                  <div className="font-bold text-lg text-slate-600">{summary.platinumTickets}</div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-slate-50 rounded border">
                <div>
                  <div className="text-xs text-muted-foreground">Ingressos PALESTRANTES</div>
                  <div className="font-bold text-lg text-rose-600">
                    {summary.palestrantesTickets}
                  </div>
                </div>
              </li>
              <li className="flex items-center gap-2 p-3 bg-slate-50 rounded border">
                <div>
                  <div className="text-xs text-muted-foreground">Ingressos HACKATHON</div>
                  <div className="font-bold text-lg text-teal-600">{summary.hackathonTickets}</div>
                </div>
              </li>
            </ul>

            {summary.skippedNoEmail > 0 && (
              <div className="flex items-start gap-2 p-3 rounded border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">
                    {summary.skippedNoEmail} linha(s) sem e-mail serão ignoradas.
                  </span>{' '}
                  A importação agrupa os compradores por e-mail; linhas sem e-mail não entram e seus
                  ingressos não são gerados. Se isso não for esperado, volte e ajuste a planilha ou
                  o mapeamento.
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              A deduplicação é por <strong>e-mail</strong> (mesma regra da importação). Se o mesmo
              e-mail aparecer em mais de uma linha, os ingressos são somados no mesmo comprador.
            </p>

            <div className="flex items-start gap-3 rounded-lg border p-3 bg-slate-50/50">
              <Checkbox
                id="send-email"
                checked={sendEmail}
                onCheckedChange={(c) => setSendEmail(c === true)}
                className="mt-0.5"
              />
              <label htmlFor="send-email" className="text-sm cursor-pointer select-none">
                <span className="font-medium">Enviar e-mail ao final da importação?</span>
                <span className="block text-muted-foreground text-xs mt-0.5">
                  Somente os compradores importados nesta rodada recebem o e-mail de acesso
                  (template <span className="font-mono">Skip-Summit26-Send-Comprador</span>).
                </span>
              </label>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setStep('mapping')}>
              Voltar
            </Button>
            <Button onClick={handleConfirmImport} className="bg-primary">
              Confirmar Importação
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === 'importing' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <div className="w-full max-w-md space-y-4 animate-fade-in">
              <FileType className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Importando dados...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

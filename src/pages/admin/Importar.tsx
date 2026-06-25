import { useState } from 'react'
import { UploadCloud, FileType, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import pb from '@/lib/pocketbase/client'

export default function AdminImport() {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const { toast } = useToast()

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setProgress(20)

    try {
      const text = await file.text()
      setProgress(50)

      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

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

      const headers = parseCSVLine(lines[0]).map((h) => h?.toLowerCase().trim() || '')

      const emailIdx = headers.findIndex((h) => h === 'email')
      const nomeIdx = headers.findIndex((h) => h === 'nome')
      const documentoIdx = headers.findIndex((h) => h === 'documento')
      const ufIdx = headers.findIndex((h) => h === 'uf')
      const cidadeIdx = headers.findIndex((h) => h === 'cidade')
      const telefoneIdx = headers.findIndex((h) => h === 'telefone')
      const qtdGoldIdx = headers.findIndex((h) => h === 'qtd gold')
      const qtdPlatinumIdx = headers.findIndex((h) => h === 'qtd platinum')

      if (emailIdx === -1) {
        throw new Error('Coluna obrigatória não encontrada no CSV (Email).')
      }

      const rows = lines
        .slice(1)
        .map((l) => {
          const cols = parseCSVLine(l)
          return {
            email: cols[emailIdx]?.trim(),
            nome: nomeIdx !== -1 ? cols[nomeIdx]?.trim() : '',
            documento: documentoIdx !== -1 ? cols[documentoIdx]?.trim() : '',
            uf: ufIdx !== -1 ? cols[ufIdx]?.trim() : '',
            cidade: cidadeIdx !== -1 ? cols[cidadeIdx]?.trim() : '',
            telefone: telefoneIdx !== -1 ? cols[telefoneIdx]?.trim() : '',
            qtd_gold: qtdGoldIdx !== -1 ? cols[qtdGoldIdx]?.trim() : '0',
            qtd_platinum: qtdPlatinumIdx !== -1 ? cols[qtdPlatinumIdx]?.trim() : '0',
          }
        })
        .filter((r) => r.email)

      setProgress(80)

      const res = await pb.send('/backend/v1/admin/import-buyers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })

      setProgress(100)
      setTimeout(() => {
        setIsUploading(false)
        setProgress(0)
        toast({
          title: 'Importação concluída',
          description: `Sucesso! ${res.imported || res.buyers || 0} compradores importados e ingressos gerados.`,
        })
      }, 500)
    } catch (err: any) {
      setIsUploading(false)
      toast({ title: 'Erro na Importação', description: err.message, variant: 'destructive' })
    }
    e.target.value = '' // reset input
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up">
      <div>
        <h2 className="text-2xl font-bold">Importar Ingressos</h2>
        <p className="text-muted-foreground">
          Faça o upload do arquivo CSV ou Excel da plataforma de vendas.
        </p>
      </div>

      <Card className="border-dashed border-2 bg-slate-50/50">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          {isUploading ? (
            <div className="w-full max-w-md space-y-4 animate-fade-in">
              <FileType className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse" />
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Processando arquivo...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            </div>
          ) : (
            <div
              className={`space-y-4 p-8 w-full rounded-xl transition-colors relative ${isDragging ? 'bg-primary/5 border-primary' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false) /* handle drop logic here if needed */
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Instruções de Mapeamento</CardTitle>
          <CardDescription>A primeira linha do arquivo deve ser o cabeçalho exato:</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-4 text-sm text-slate-700">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-300" /> Nome
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Email (Obrigatório)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-300" /> documento
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-300" /> UF
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-300" /> Cidade
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-slate-300" /> Telefone
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Qtd Gold
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Qtd Platinum
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
